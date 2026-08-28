-- KYO v26 — Envío gratis + propina separada para repartidor
-- Ejecutar DESPUÉS de migrate-v22-9-idempotency.sql y migrate-v24-panel-por-sucursal.sql.
--
-- Modelo contable:
--   subtotal       = productos/personalizaciones
--   delivery_fee   = 0 (todos los envíos nuevos son gratis)
--   total          = venta de KYO, SIN propina
--   tip_amount     = dinero exclusivo del repartidor
--   payment_total  = importe total que paga/cobra el cliente (venta KYO + propina)
--
-- Cuando se integre Stripe, `payment_total` es el importe que debe enviarse al cobro.

alter table public.orders add column if not exists tip_percentage smallint not null default 0;
alter table public.orders add column if not exists tip_amount numeric(10,2) not null default 0;
alter table public.orders add column if not exists payment_total numeric(10,2) not null default 0;

alter table public.orders drop constraint if exists orders_tip_percentage_check;
alter table public.orders add constraint orders_tip_percentage_check
  check (tip_percentage in (0,5,10,20));

alter table public.orders drop constraint if exists orders_tip_amount_check;
alter table public.orders add constraint orders_tip_amount_check
  check (tip_amount >= 0);

-- Los pedidos históricos no se modifican: si antes tuvieron $39 de envío, se conserva su historia.
-- Solo inicializamos el total cobrado histórico para que la nueva columna sea consistente.
update public.orders
set payment_total = total + coalesce(tip_amount,0)
where payment_total is distinct from total + coalesce(tip_amount,0);

-- Bloquear la firma anterior para clientes autenticados: los pedidos nuevos deben traer idempotency key.
-- Deshabilita la versión v22.9 de 7 parámetros para que todos los pedidos nuevos
-- pasen por la versión con propina y envío gratis.
revoke execute on function public.create_order(text,text,uuid,text,text,jsonb,uuid) from authenticated;

create or replace function public.create_order(
  p_branch_id text,
  p_fulfillment_type text,
  p_address_id uuid,
  p_delivery_notes text,
  p_payment_method text,
  p_items jsonb,
  p_idempotency_key uuid,
  p_tip_percentage integer
)
returns table(id uuid, order_number bigint, total numeric)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_order_id uuid;
  v_order_number bigint;
  v_subtotal numeric(10,2):=0;
  v_delivery_fee numeric(10,2):=0;
  v_total numeric(10,2):=0;
  v_tip_percentage integer:=0;
  v_tip_amount numeric(10,2):=0;
  v_payment_total numeric(10,2):=0;
  v_minimum_order numeric(10,2):=200;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_address public.addresses%rowtype;
  v_branch_id text;
  v_address_text text;
  v_voucher_id uuid;
  v_voucher public.reward_vouchers%rowtype;
  v_custom jsonb;
  v_template public.customization_templates%rowtype;
  v_option jsonb;
  v_option_price numeric(10,2);
  v_custom_qty integer;
  v_item_extra numeric(10,2);
begin
  if v_user is null then raise exception 'Debes iniciar sesión'; end if;
  if p_idempotency_key is null then raise exception 'Falta identificador de seguridad del pedido'; end if;

  -- Si esta misma solicitud ya creó el pedido, regresar exactamente ese pedido.
  select o.id,o.order_number,o.total
    into v_order_id,v_order_number,v_total
  from public.orders o
  where o.user_id=v_user
    and o.client_request_id=p_idempotency_key
  limit 1;

  if found then
    return query select v_order_id,v_order_number,v_total;
    return;
  end if;

  if p_fulfillment_type not in ('delivery','pickup') then raise exception 'Tipo de entrega inválido'; end if;

  -- La propina es opcional y exclusivamente para Delivery. El servidor no confía
  -- en el importe enviado por el navegador: solo recibe el porcentaje y calcula aquí.
  if coalesce(p_tip_percentage,0) not in (0,5,10,20) then
    raise exception 'Porcentaje de propina inválido';
  end if;
  v_tip_percentage:=case when p_fulfillment_type='delivery' then coalesce(p_tip_percentage,0) else 0 end;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'El carrito está vacío'; end if;

  select coalesce(s.minimum_order,200)
  into v_minimum_order
  from public.app_settings s
  where s.id='main';

  v_minimum_order:=coalesce(v_minimum_order,200);

  if p_fulfillment_type='delivery' then
    if p_address_id is null then raise exception 'Falta dirección de entrega'; end if;
    select a.* into v_address
    from public.addresses a
    where a.id=p_address_id and a.user_id=v_user;
    if not found then raise exception 'Dirección inválida'; end if;

    v_branch_id:=v_address.branch_id;
    v_address_text:=concat_ws(', ',
      nullif(trim(coalesce(v_address.street,v_address.address_line)),''),
      case when nullif(trim(coalesce(v_address.exterior_number,'')),'') is not null then '#'||trim(v_address.exterior_number) end,
      case when nullif(trim(coalesce(v_address.interior_number,'')),'') is not null then 'Int. '||trim(v_address.interior_number) end,
      nullif(trim(coalesce(v_address.neighborhood,'')),''),
      case when nullif(trim(coalesce(v_address.postal_code,'')),'') is not null then 'CP '||trim(v_address.postal_code) end
    );
  else
    if not exists(select 1 from public.branches b where b.id=p_branch_id and b.active=true) then
      raise exception 'Sucursal inválida';
    end if;
    v_branch_id:=p_branch_id;
    v_address_text:=null;
  end if;

  -- Primera pasada: validar y calcular subtotal real.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=greatest(1,least(20,coalesce((v_item->>'quantity')::int,1)));

    select p.* into v_product
    from public.products p
    where p.id=(v_item->>'product_id')::uuid and p.available=true;
    if not found then raise exception 'Uno de los productos ya no está disponible'; end if;

    if exists(
      select 1 from public.product_branch_availability pba
      where pba.product_id=v_product.id
        and pba.branch_id=v_branch_id
        and pba.available=false
    ) then
      raise exception '% no está disponible en esta sucursal',v_product.name;
    end if;

    v_item_extra:=0;

    for v_custom in
      select * from jsonb_array_elements(coalesce(v_item->'customizations','[]'::jsonb))
    loop
      select ct.* into v_template
      from public.customization_templates ct
      join public.product_customizations pc on pc.template_id=ct.id
      where pc.product_id=v_product.id
        and ct.id=(v_custom->>'template_id')::uuid;

      if not found then raise exception 'Personalización inválida para %',v_product.name; end if;

      select o into v_option
      from jsonb_array_elements(v_template.options) o
      where o->>'id'=v_custom->>'option_id'
      limit 1;

      if v_option is null then raise exception 'Opción de personalización inválida'; end if;

      if exists(
        select 1
        from public.customization_option_branch_availability coba
        where coba.template_id=v_template.id
          and coba.option_id=v_custom->>'option_id'
          and coba.branch_id=v_branch_id
          and coba.available=false
      ) then
        raise exception 'Una personalización seleccionada no está disponible en esta sucursal';
      end if;

      v_custom_qty:=greatest(1,least(20,coalesce((v_custom->>'quantity')::int,1)));
      v_option_price:=coalesce((v_option->>'price')::numeric,0);
      v_item_extra:=v_item_extra+(v_option_price*v_custom_qty);
    end loop;

    v_voucher_id:=nullif(v_item->>'reward_voucher_id','')::uuid;

    if v_voucher_id is null then
      v_subtotal:=v_subtotal+((v_product.price+v_item_extra)*v_qty);
    else
      select rv.* into v_voucher
      from public.reward_vouchers rv
      where rv.id=v_voucher_id
        and rv.user_id=v_user
        and rv.status='available';

      if not found then raise exception 'Este reward ya no está disponible'; end if;
      if v_qty<>1 then raise exception 'Los rewards solo pueden agregarse una vez'; end if;

      if v_voucher.reward_type='spring_rolls' then
        if v_voucher.reward_product_id is null or v_product.id<>v_voucher.reward_product_id then
          raise exception 'Este reward no corresponde al producto seleccionado';
        end if;
        -- Producto gratis. Los extras de personalización, si los hay, conservan su costo.
        v_subtotal:=v_subtotal+v_item_extra;

      elsif v_voucher.reward_type='free_roll' then
        if not exists(
          select 1
          from public.categories c
          where c.id=v_product.subcategory_id
            and (
              lower(c.name) in ('clásicos','clasicos')
              or lower(c.slug) in ('clasicos','clásicos')
            )
        ) then
          raise exception 'El reward de 6 pedidos solo aplica a rollos Clásicos';
        end if;
        -- Rollo + sus personalizaciones gratis.
        v_subtotal:=v_subtotal+0;
      else
        raise exception 'Tipo de reward inválido';
      end if;
    end if;
  end loop;

  if v_subtotal < v_minimum_order then
    raise exception 'El pedido mínimo es de $%. Te faltan $% en productos',
      trim(to_char(v_minimum_order,'FM999999990.00')),
      trim(to_char(v_minimum_order-v_subtotal,'FM999999990.00'));
  end if;

  -- v26: envío siempre gratis. `total` representa exclusivamente la venta de KYO,
  -- sin propina, para que reportes, ticket promedio y KPIs no la contabilicen como ingreso.
  v_delivery_fee:=0;
  v_total:=v_subtotal;
  v_tip_amount:=round((v_subtotal*v_tip_percentage/100.0)::numeric,2);
  v_payment_total:=v_total+v_tip_amount;

  insert into public.orders(
    user_id,client_request_id,branch_id,fulfillment_type,delivery_address,delivery_reference,
    delivery_notes,payment_method,status,subtotal,delivery_fee,total,tip_percentage,tip_amount,payment_total
  )
  values(
    v_user,p_idempotency_key,v_branch_id,p_fulfillment_type,v_address_text,
    case when p_fulfillment_type='delivery' then v_address.notes else null end,
    p_delivery_notes,p_payment_method,'preparing',v_subtotal,v_delivery_fee,v_total,v_tip_percentage,v_tip_amount,v_payment_total
  )
  returning public.orders.id,public.orders.order_number
  into v_order_id,v_order_number;

  -- Segunda pasada: guardar líneas y consumir vouchers.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=greatest(1,least(20,coalesce((v_item->>'quantity')::int,1)));

    select p.* into v_product
    from public.products p
    where p.id=(v_item->>'product_id')::uuid;

    v_item_extra:=0;
    for v_custom in select * from jsonb_array_elements(coalesce(v_item->'customizations','[]'::jsonb)) loop
      select ct.* into v_template
      from public.customization_templates ct
      where ct.id=(v_custom->>'template_id')::uuid;

      select o into v_option
      from jsonb_array_elements(v_template.options) o
      where o->>'id'=v_custom->>'option_id'
      limit 1;

      v_custom_qty:=greatest(1,least(20,coalesce((v_custom->>'quantity')::int,1)));
      v_item_extra:=v_item_extra+(coalesce((v_option->>'price')::numeric,0)*v_custom_qty);
    end loop;

    v_voucher_id:=nullif(v_item->>'reward_voucher_id','')::uuid;

    if v_voucher_id is null then
      insert into public.order_items(
        order_id,product_id,product_name,unit_price,quantity,customizations,item_note
      )
      values(
        v_order_id,v_product.id,v_product.name,v_product.price+v_item_extra,v_qty,
        coalesce(v_item->'customizations','[]'::jsonb),
        left(coalesce(v_item->>'item_note',''),250)
      );
    else
      select rv.* into v_voucher
      from public.reward_vouchers rv
      where rv.id=v_voucher_id
        and rv.user_id=v_user
        and rv.status='available'
      for update;

      if not found then raise exception 'Este reward ya fue utilizado'; end if;

      update public.reward_vouchers rv
      set status='redeemed',redeemed_at=now()
      where rv.id=v_voucher.id;

      insert into public.order_items(
        order_id,product_id,product_name,unit_price,quantity,customizations,item_note
      )
      values(
        v_order_id,v_product.id,v_product.name,
        case when v_voucher.reward_type='spring_rolls' then v_item_extra else 0 end,
        1,
        coalesce(v_item->'customizations','[]'::jsonb),
        left(coalesce(v_item->>'item_note',''),250)
      );
    end if;
  end loop;

  return query select v_order_id,v_order_number,v_total;
  return;

exception
  when unique_violation then
    -- Dos requests idénticos pudieron llegar al mismo tiempo.
    -- El índice único garantiza que solo uno se crea; el segundo recibe el mismo pedido.
    select o.id,o.order_number,o.total
      into v_order_id,v_order_number,v_total
    from public.orders o
    where o.user_id=v_user
      and o.client_request_id=p_idempotency_key
    limit 1;

    if found then
      return query select v_order_id,v_order_number,v_total;
      return;
    end if;

    raise;
end;
$$;

revoke all on function public.create_order(text,text,uuid,text,text,jsonb,uuid,integer) from public;
grant execute on function public.create_order(text,text,uuid,text,text,jsonb,uuid,integer) to authenticated;
