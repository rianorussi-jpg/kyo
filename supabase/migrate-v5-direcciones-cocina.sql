-- Ejecuta este archivo UNA VEZ en Supabase > SQL Editor sobre tu proyecto actual.
-- Agrega direcciones completas, /modococina y cambia los pedidos nuevos a Preparando.

alter table public.profiles add column if not exists kitchen_branch text;
do $$ begin
  alter table public.profiles add constraint profiles_kitchen_branch_check check (kitchen_branch is null or kitchen_branch in ('zakia','milenio'));
exception when duplicate_object then null; end $$;

alter table public.addresses add column if not exists street text;
alter table public.addresses add column if not exists exterior_number text;
alter table public.addresses add column if not exists interior_number text;
alter table public.addresses add column if not exists neighborhood text;
alter table public.addresses add column if not exists postal_code text;
alter table public.addresses add column if not exists branch_id text;
update public.addresses set street=coalesce(street,address_line) where street is null;
update public.addresses set branch_id=coalesce(branch_id,'zakia') where branch_id is null;
do $$ begin
  alter table public.addresses add constraint addresses_branch_fk foreign key (branch_id) references public.branches(id);
exception when duplicate_object then null; end $$;

alter table public.orders add column if not exists delivery_reference text;
alter table public.orders alter column status set default 'preparing';

create or replace function public.is_kitchen_for_branch(uid uuid, p_branch text)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=uid and p.kitchen_branch=p_branch);
$$;

drop policy if exists "kitchen orders select" on public.orders;
create policy "kitchen orders select" on public.orders for select using (public.is_kitchen_for_branch(auth.uid(),branch_id));
drop policy if exists "kitchen orders update" on public.orders;
create policy "kitchen orders update" on public.orders for update using (public.is_kitchen_for_branch(auth.uid(),branch_id)) with check (public.is_kitchen_for_branch(auth.uid(),branch_id));
drop policy if exists "kitchen order items select" on public.order_items;
create policy "kitchen order items select" on public.order_items for select using (exists(select 1 from public.orders o where o.id=order_id and public.is_kitchen_for_branch(auth.uid(),o.branch_id)));
drop policy if exists "kitchen customer profile read" on public.profiles;
create policy "kitchen customer profile read" on public.profiles for select using (exists(select 1 from public.orders o where o.user_id=profiles.id and public.is_kitchen_for_branch(auth.uid(),o.branch_id)));

create or replace function public.create_order(
  p_branch_id text,
  p_fulfillment_type text,
  p_address_id uuid,
  p_delivery_notes text,
  p_payment_method text,
  p_items jsonb
)
returns table(id uuid, order_number bigint, total numeric)
language plpgsql security definer set search_path=public as $$
declare
  v_user uuid:=auth.uid(); v_order_id uuid; v_order_number bigint;
  v_subtotal numeric(10,2):=0; v_delivery_fee numeric(10,2):=0; v_total numeric(10,2):=0;
  v_item jsonb; v_product public.products%rowtype; v_qty integer;
  v_address public.addresses%rowtype; v_branch_id text; v_address_text text;
begin
  if v_user is null then raise exception 'Debes iniciar sesión'; end if;
  if p_fulfillment_type not in ('delivery','pickup') then raise exception 'Tipo de entrega inválido'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'El carrito está vacío'; end if;

  if p_fulfillment_type='delivery' then
    if p_address_id is null then raise exception 'Falta dirección de entrega'; end if;
    select a.* into v_address from public.addresses a where a.id=p_address_id and a.user_id=v_user;
    if not found then raise exception 'Dirección inválida'; end if;
    v_branch_id:=v_address.branch_id;
    v_address_text:=concat_ws(', ',nullif(trim(coalesce(v_address.street,v_address.address_line)),''),
      case when nullif(trim(coalesce(v_address.exterior_number,'')),'') is not null then '#'||trim(v_address.exterior_number) end,
      case when nullif(trim(coalesce(v_address.interior_number,'')),'') is not null then 'Int. '||trim(v_address.interior_number) end,
      nullif(trim(coalesce(v_address.neighborhood,'')),''),
      case when nullif(trim(coalesce(v_address.postal_code,'')),'') is not null then 'CP '||trim(v_address.postal_code) end);
  else
    if not exists(select 1 from public.branches b where b.id=p_branch_id and b.active=true) then raise exception 'Sucursal inválida'; end if;
    v_branch_id:=p_branch_id; v_address_text:=null;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=greatest(1,least(20,coalesce((v_item->>'quantity')::int,1)));
    select p.* into v_product from public.products p where p.id=(v_item->>'product_id')::uuid and p.available=true;
    if not found then raise exception 'Uno de los productos ya no está disponible'; end if;
    v_subtotal:=v_subtotal+(v_product.price*v_qty);
  end loop;

  v_delivery_fee:=case when p_fulfillment_type='delivery' then 39 else 0 end; v_total:=v_subtotal+v_delivery_fee;
  insert into public.orders(user_id,branch_id,fulfillment_type,delivery_address,delivery_reference,delivery_notes,payment_method,status,subtotal,delivery_fee,total)
  values(v_user,v_branch_id,p_fulfillment_type,v_address_text,case when p_fulfillment_type='delivery' then v_address.notes else null end,p_delivery_notes,p_payment_method,'preparing',v_subtotal,v_delivery_fee,v_total)
  returning public.orders.id,public.orders.order_number into v_order_id,v_order_number;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=greatest(1,least(20,coalesce((v_item->>'quantity')::int,1)));
    select p.* into v_product from public.products p where p.id=(v_item->>'product_id')::uuid;
    insert into public.order_items(order_id,product_id,product_name,unit_price,quantity) values(v_order_id,v_product.id,v_product.name,v_product.price,v_qty);
  end loop;
  return query select v_order_id,v_order_number,v_total;
end; $$;

revoke all on function public.create_order(text,text,uuid,text,text,jsonb) from public;
grant execute on function public.create_order(text,text,uuid,text,text,jsonb) to authenticated;

-- DESPUÉS de crear ambas cuentas en Authentication > Users, ejecuta:
-- update public.profiles set kitchen_branch='zakia' where id=(select id from auth.users where email='zakia@kyosushi.mx');
-- update public.profiles set kitchen_branch='milenio' where id=(select id from auth.users where email='milenio@kyosushi.mx');
