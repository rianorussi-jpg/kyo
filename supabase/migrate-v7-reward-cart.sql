-- KYO v7: permite usar un voucher de 4 Spring Rolls directamente dentro del carrito.
-- Ejecuta UNA VEZ en Supabase > SQL Editor sobre la base actual.

create or replace function public.create_order(
  p_branch_id text,
  p_fulfillment_type text,
  p_address_id uuid,
  p_delivery_notes text,
  p_payment_method text,
  p_items jsonb
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
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_address public.addresses%rowtype;
  v_branch_id text;
  v_address_text text;
  v_voucher_id uuid;
  v_voucher public.reward_vouchers%rowtype;
begin
  if v_user is null then raise exception 'Debes iniciar sesión'; end if;
  if p_fulfillment_type not in ('delivery','pickup') then raise exception 'Tipo de entrega inválido'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'El carrito está vacío'; end if;

  if p_fulfillment_type='delivery' then
    if p_address_id is null then raise exception 'Falta dirección de entrega'; end if;
    select a.* into v_address from public.addresses a where a.id=p_address_id and a.user_id=v_user;
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
    if not exists(select 1 from public.branches b where b.id=p_branch_id and b.active=true) then raise exception 'Sucursal inválida'; end if;
    v_branch_id:=p_branch_id;
    v_address_text:=null;
  end if;

  -- Calcula el subtotal en servidor. Un reward válido vale $0 y siempre es cantidad 1.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=greatest(1,least(20,coalesce((v_item->>'quantity')::int,1)));
    select p.* into v_product from public.products p where p.id=(v_item->>'product_id')::uuid and p.available=true;
    if not found then raise exception 'Uno de los productos ya no está disponible'; end if;

    v_voucher_id:=nullif(v_item->>'reward_voucher_id','')::uuid;
    if v_voucher_id is not null then
      select rv.* into v_voucher from public.reward_vouchers rv
        where rv.id=v_voucher_id and rv.user_id=v_user and rv.status='available';
      if not found then raise exception 'Este beneficio ya no está disponible'; end if;
      if v_voucher.reward_type<>'spring_rolls' or v_product.slug<>'spring-rolls' then
        raise exception 'El beneficio no corresponde a este producto';
      end if;
      if v_qty<>1 then raise exception 'Los rewards solo pueden agregarse una vez'; end if;
    else
      v_subtotal:=v_subtotal+(v_product.price*v_qty);
    end if;
  end loop;

  v_delivery_fee:=case when p_fulfillment_type='delivery' then 39 else 0 end;
  v_total:=v_subtotal+v_delivery_fee;

  insert into public.orders(user_id,branch_id,fulfillment_type,delivery_address,delivery_reference,delivery_notes,payment_method,status,subtotal,delivery_fee,total)
  values(v_user,v_branch_id,p_fulfillment_type,v_address_text,
    case when p_fulfillment_type='delivery' then v_address.notes else null end,
    p_delivery_notes,p_payment_method,'preparing',v_subtotal,v_delivery_fee,v_total)
  returning public.orders.id,public.orders.order_number into v_order_id,v_order_number;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=greatest(1,least(20,coalesce((v_item->>'quantity')::int,1)));
    select p.* into v_product from public.products p where p.id=(v_item->>'product_id')::uuid;
    v_voucher_id:=nullif(v_item->>'reward_voucher_id','')::uuid;

    if v_voucher_id is not null then
      -- Consumir el voucher aquí impide usar el mismo dos veces. Si algo falla, toda la transacción se revierte.
      update public.reward_vouchers rv
        set status='redeemed', redeemed_at=now()
        where rv.id=v_voucher_id and rv.user_id=v_user and rv.status='available' and rv.reward_type='spring_rolls';
      if not found then raise exception 'Este beneficio ya fue utilizado'; end if;
      insert into public.order_items(order_id,product_id,product_name,unit_price,quantity)
      values(v_order_id,v_product.id,v_product.name,0,1);
    else
      insert into public.order_items(order_id,product_id,product_name,unit_price,quantity)
      values(v_order_id,v_product.id,v_product.name,v_product.price,v_qty);
    end if;
  end loop;

  return query select v_order_id,v_order_number,v_total;
end;
$$;

revoke all on function public.create_order(text,text,uuid,text,text,jsonb) from public;
grant execute on function public.create_order(text,text,uuid,text,text,jsonb) to authenticated;
