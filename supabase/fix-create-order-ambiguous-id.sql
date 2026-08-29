-- KYO Sushi: corrige "column reference id is ambiguous" al crear pedidos
-- Ejecuta TODO este archivo en Supabase > SQL Editor > New query > Run.

create or replace function public.create_order(
  p_branch_id text,
  p_fulfillment_type text,
  p_delivery_address text,
  p_delivery_notes text,
  p_payment_method text,
  p_items jsonb
)
returns table(id uuid, order_number bigint, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_order_id uuid;
  v_order_number bigint;
  v_subtotal numeric(10,2) := 0;
  v_delivery_fee numeric(10,2) := 0;
  v_total numeric(10,2) := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
begin
  if v_user is null then raise exception 'Debes iniciar sesión'; end if;
  if p_fulfillment_type not in ('delivery','pickup') then raise exception 'Tipo de entrega inválido'; end if;
  if p_fulfillment_type = 'delivery' and coalesce(trim(p_delivery_address),'') = '' then raise exception 'Falta dirección de entrega'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0 then raise exception 'El carrito está vacío'; end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, least(20, coalesce((v_item->>'quantity')::int,1)));
    select p.* into v_product
    from public.products p
    where p.id = (v_item->>'product_id')::uuid
      and p.available = true;
    if not found then raise exception 'Uno de los productos ya no está disponible'; end if;
    v_subtotal := v_subtotal + (v_product.price * v_qty);
  end loop;

  v_delivery_fee := case when p_fulfillment_type='delivery' then 39 else 0 end;
  v_total := v_subtotal + v_delivery_fee;

  insert into public.orders(user_id,branch_id,fulfillment_type,delivery_address,delivery_notes,payment_method,subtotal,delivery_fee,total)
  values(v_user,p_branch_id,p_fulfillment_type,p_delivery_address,p_delivery_notes,p_payment_method,v_subtotal,v_delivery_fee,v_total)
  returning public.orders.id, public.orders.order_number into v_order_id, v_order_number;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := greatest(1, least(20, coalesce((v_item->>'quantity')::int,1)));
    select p.* into v_product
    from public.products p
    where p.id = (v_item->>'product_id')::uuid;

    insert into public.order_items(order_id,product_id,product_name,unit_price,quantity)
    values(v_order_id,v_product.id,v_product.name,v_product.price,v_qty);
  end loop;

  return query select v_order_id, v_order_number, v_total;
end;
$$;

revoke all on function public.create_order(text,text,text,text,text,jsonb) from public;
grant execute on function public.create_order(text,text,text,text,text,jsonb) to authenticated;
