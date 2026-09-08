-- KYO v29 — Zonas de entrega por colonia, cocina y costo
-- Ejecutar DESPUÉS de migrate-v28-promo-3x2.sql.
-- El costo de envío y la cocina se validan en Supabase al crear el pedido.

create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  branch_id text not null references public.branches(id),
  fee numeric(10,2) not null default 0 check (fee >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.delivery_zones enable row level security;

drop policy if exists "delivery zones public read" on public.delivery_zones;
create policy "delivery zones public read"
on public.delivery_zones for select
using (true);

drop policy if exists "delivery zones general admin insert" on public.delivery_zones;
create policy "delivery zones general admin insert"
on public.delivery_zones for insert
with check (
  exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.is_admin=true and p.panel_branch is null
  )
);

drop policy if exists "delivery zones general admin update" on public.delivery_zones;
create policy "delivery zones general admin update"
on public.delivery_zones for update
using (
  exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.is_admin=true and p.panel_branch is null
  )
)
with check (
  exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.is_admin=true and p.panel_branch is null
  )
);

drop policy if exists "delivery zones general admin delete" on public.delivery_zones;
create policy "delivery zones general admin delete"
on public.delivery_zones for delete
using (
  exists(
    select 1 from public.profiles p
    where p.id=auth.uid() and p.is_admin=true and p.panel_branch is null
  )
);

alter table public.addresses
  add column if not exists delivery_zone_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='addresses_delivery_zone_fk'
  ) then
    alter table public.addresses
      add constraint addresses_delivery_zone_fk
      foreign key (delivery_zone_id)
      references public.delivery_zones(id)
      on delete set null;
  end if;
end $$;

insert into public.delivery_zones(name,branch_id,fee,active,sort_order) values
  ('Zákia','zakia',20,true,10),
  ('Zizaná','zakia',20,true,20),
  ('Ziré','zakia',25,true,30),
  ('Zibatá','zakia',70,true,40),
  ('Zibatá Chichimequillas','zakia',90,true,50),
  ('La Pradera','zakia',70,true,60),
  ('El Refugio','zakia',70,true,70),
  ('Campanario Norte','zakia',90,true,80),
  ('La ceiba','zakia',90,true,90),
  ('Milenio','milenio',25,true,110),
  ('Cuesta bonita','milenio',45,true,120),
  ('Hércules','milenio',65,true,130),
  ('Loma dorada','milenio',55,true,140),
  ('Vista hermosa','milenio',55,true,150),
  ('Residencial del parqué','milenio',55,true,160),
  ('Mirador','milenio',65,true,170),
  ('Zen life','milenio',80,true,180),
  ('La cañada','milenio',80,true,190),
  ('El campanario','milenio',120,true,200)
on conflict(name) do update set
  branch_id=excluded.branch_id,
  fee=excluded.fee,
  active=excluded.active,
  sort_order=excluded.sort_order,
  updated_at=now();

-- Vincula direcciones existentes cuando la colonia coincide con una zona.
update public.addresses a
set delivery_zone_id=z.id,
    branch_id=z.branch_id,
    neighborhood=z.name
from public.delivery_zones z
where a.delivery_zone_id is null
  and lower(trim(coalesce(a.neighborhood,'')))=lower(trim(z.name));

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
  v_zone public.delivery_zones%rowtype;
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
  v_pre_discount_subtotal numeric(10,2):=0;
  v_promo_discount numeric(10,2):=0;
  v_promo_enabled boolean:=false;
  v_promo_active boolean:=false;
  v_promo_days text[]:=array['tue','wed','thu'];
  v_server_day text;
  v_promo_prices numeric[]:=array[]::numeric[];
  v_free_count integer:=0;
  v_n integer;
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
  if p_payment_method not in ('cash','card','terminal') then raise exception 'Método de pago inválido'; end if;

  -- La propina es opcional y exclusivamente para Delivery. El servidor no confía
  -- en el importe enviado por el navegador: solo recibe el porcentaje y calcula aquí.
  if coalesce(p_tip_percentage,0) not in (0,5,10,20) then
    raise exception 'Porcentaje de propina inválido';
  end if;
  v_tip_percentage:=case when p_fulfillment_type='delivery' then coalesce(p_tip_percentage,0) else 0 end;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'El carrito está vacío'; end if;

  select coalesce(s.minimum_order,200),coalesce(s.promo_3x2_enabled,false),coalesce(s.promo_3x2_days,array['tue','wed','thu']::text[])
  into v_minimum_order,v_promo_enabled,v_promo_days
  from public.app_settings s
  where s.id='main';

  v_minimum_order:=coalesce(v_minimum_order,200);
  v_server_day:=case extract(isodow from timezone('America/Mexico_City',now()))::int
    when 1 then 'mon' when 2 then 'tue' when 3 then 'wed' when 4 then 'thu'
    when 5 then 'fri' when 6 then 'sat' else 'sun' end;
  v_promo_active:=v_promo_enabled and v_server_day=any(v_promo_days);

  if p_fulfillment_type='delivery' then
    if p_address_id is null then raise exception 'Falta dirección de entrega'; end if;
    select a.* into v_address
    from public.addresses a
    where a.id=p_address_id and a.user_id=v_user;
    if not found then raise exception 'Dirección inválida'; end if;

    select z.* into v_zone
    from public.delivery_zones z
    where z.active=true
      and (
        z.id=v_address.delivery_zone_id
        or (
          v_address.delivery_zone_id is null
          and lower(trim(z.name))=lower(trim(coalesce(v_address.neighborhood,'')))
        )
      )
    order by case when z.id=v_address.delivery_zone_id then 0 else 1 end
    limit 1;

    if not found then
      raise exception 'Esta dirección no tiene una colonia de entrega válida. Actualízala antes de continuar.';
    end if;

    v_branch_id:=v_zone.branch_id;
    v_delivery_fee:=coalesce(v_zone.fee,0);
    v_address_text:=concat_ws(', ',
      nullif(trim(coalesce(v_address.street,v_address.address_line)),''),
      case when nullif(trim(coalesce(v_address.exterior_number,'')),'') is not null then '#'||trim(v_address.exterior_number) end,
      case when nullif(trim(coalesce(v_address.interior_number,'')),'') is not null then 'Int. '||trim(v_address.interior_number) end,
      v_zone.name,
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
      if v_promo_active and coalesce(v_product.promo_3x2_eligible,false) then
        for v_n in 1..v_qty loop
          v_promo_prices:=array_append(v_promo_prices,v_product.price);
        end loop;
      end if;
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

  v_pre_discount_subtotal:=v_subtotal;

  -- 3x2 validado exclusivamente con la hora/día del servidor de Supabase (CDMX).
  -- Por cada 3 unidades participantes, se descuenta el precio BASE de la más barata.
  -- Personalizaciones y extras siempre conservan su costo.
  if v_promo_active and coalesce(array_length(v_promo_prices,1),0)>=3 then
    v_free_count:=floor(coalesce(array_length(v_promo_prices,1),0)/3.0)::int;
    select coalesce(sum(x.price),0) into v_promo_discount
    from (select unnest(v_promo_prices) as price order by price asc limit v_free_count) x;
    v_subtotal:=greatest(0,v_subtotal-v_promo_discount);
  end if;

  -- El pedido mínimo se valida antes del descuento para que la promo no perjudique al cliente.
  if v_pre_discount_subtotal < v_minimum_order then
    raise exception 'El pedido mínimo es de $%. Te faltan $% en productos',
      trim(to_char(v_minimum_order,'FM999999990.00')),
      trim(to_char(v_minimum_order-v_pre_discount_subtotal,'FM999999990.00'));
  end if;

  -- v29: el envío se obtiene exclusivamente de la colonia guardada en Supabase.
  -- La propina se calcula SOLO sobre productos después de promociones; nunca sobre el envío.
  if p_fulfillment_type='pickup' then
    v_delivery_fee:=0;
  end if;
  v_total:=v_subtotal+v_delivery_fee;
  v_tip_amount:=round((v_subtotal*v_tip_percentage/100.0)::numeric,2);
  v_payment_total:=v_total+v_tip_amount;

  insert into public.orders(
    user_id,client_request_id,branch_id,fulfillment_type,delivery_address,delivery_reference,
    delivery_notes,payment_method,status,subtotal,delivery_fee,total,tip_percentage,tip_amount,payment_total,payment_status,promo_discount,promo_3x2_applied
  )
  values(
    v_user,p_idempotency_key,v_branch_id,p_fulfillment_type,v_address_text,
    case when p_fulfillment_type='delivery' then v_address.notes else null end,
    p_delivery_notes,p_payment_method,case when p_payment_method='card' then 'pending_payment' else 'preparing' end,v_subtotal,v_delivery_fee,v_total,v_tip_percentage,v_tip_amount,v_payment_total,case when p_payment_method='card' then 'pending' else 'not_required' end,v_promo_discount,(v_promo_discount>0)
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
