-- KYO v10: personalizaciones reutilizables por producto + notas por artículo.
-- Ejecuta UNA VEZ en Supabase > SQL Editor sobre una base que ya tenga v7/v9.

create table if not exists public.customization_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  input_type text not null check (input_type in ('single','multiple','quantity')),
  required boolean not null default false,
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 1),
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_customizations (
  product_id uuid not null references public.products(id) on delete cascade,
  template_id uuid not null references public.customization_templates(id) on delete cascade,
  sort_order integer not null default 10,
  primary key(product_id,template_id)
);

alter table public.order_items add column if not exists customizations jsonb not null default '[]'::jsonb;
alter table public.order_items add column if not exists item_note text;

alter table public.customization_templates enable row level security;
alter table public.product_customizations enable row level security;

drop policy if exists "customizations public read" on public.customization_templates;
create policy "customizations public read" on public.customization_templates for select using (true);
drop policy if exists "product customizations public read" on public.product_customizations;
create policy "product customizations public read" on public.product_customizations for select using (true);
drop policy if exists "admins manage customizations" on public.customization_templates;
create policy "admins manage customizations" on public.customization_templates for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
drop policy if exists "admins manage product customizations" on public.product_customizations;
create policy "admins manage product customizations" on public.product_customizations for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

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
  v_custom jsonb;
  v_template public.customization_templates%rowtype;
  v_option jsonb;
  v_option_price numeric(10,2);
  v_custom_qty integer;
  v_item_extra numeric(10,2);
begin
  if v_user is null then raise exception 'Debes iniciar sesión'; end if;
  if p_fulfillment_type not in ('delivery','pickup') then raise exception 'Tipo de entrega inválido'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'El carrito está vacío'; end if;

  if p_fulfillment_type='delivery' then
    if p_address_id is null then raise exception 'Falta dirección de entrega'; end if;
    select a.* into v_address from public.addresses a where a.id=p_address_id and a.user_id=v_user;
    if not found then raise exception 'Dirección inválida'; end if;
    v_branch_id:=v_address.branch_id;
    v_address_text:=concat_ws(', ',nullif(trim(coalesce(v_address.street,v_address.address_line)),''),case when nullif(trim(coalesce(v_address.exterior_number,'')),'') is not null then '#'||trim(v_address.exterior_number) end,case when nullif(trim(coalesce(v_address.interior_number,'')),'') is not null then 'Int. '||trim(v_address.interior_number) end,nullif(trim(coalesce(v_address.neighborhood,'')),''),case when nullif(trim(coalesce(v_address.postal_code,'')),'') is not null then 'CP '||trim(v_address.postal_code) end);
  else
    if not exists(select 1 from public.branches b where b.id=p_branch_id and b.active=true) then raise exception 'Sucursal inválida'; end if;
    v_branch_id:=p_branch_id; v_address_text:=null;
  end if;

  -- Precio calculado completamente en servidor, incluyendo extras de personalización.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=greatest(1,least(20,coalesce((v_item->>'quantity')::int,1)));
    select p.* into v_product from public.products p where p.id=(v_item->>'product_id')::uuid and p.available=true;
    if not found then raise exception 'Uno de los productos ya no está disponible'; end if;
    v_item_extra:=0;

    for v_custom in select * from jsonb_array_elements(coalesce(v_item->'customizations','[]'::jsonb)) loop
      select ct.* into v_template
      from public.customization_templates ct
      join public.product_customizations pc on pc.template_id=ct.id
      where pc.product_id=v_product.id and ct.id=(v_custom->>'template_id')::uuid;
      if not found then raise exception 'Personalización inválida para %',v_product.name; end if;
      select o into v_option from jsonb_array_elements(v_template.options) o where o->>'id'=v_custom->>'option_id' limit 1;
      if v_option is null then raise exception 'Opción de personalización inválida'; end if;
      v_custom_qty:=greatest(1,least(20,coalesce((v_custom->>'quantity')::int,1)));
      v_option_price:=coalesce((v_option->>'price')::numeric,0);
      v_item_extra:=v_item_extra+(v_option_price*v_custom_qty);
    end loop;

    v_voucher_id:=nullif(v_item->>'reward_voucher_id','')::uuid;
    if v_voucher_id is not null then
      select rv.* into v_voucher from public.reward_vouchers rv where rv.id=v_voucher_id and rv.user_id=v_user and rv.status='available';
      if not found then raise exception 'Este beneficio ya no está disponible'; end if;
      if v_voucher.reward_type<>'spring_rolls' or v_product.slug<>'spring-rolls' then raise exception 'El beneficio no corresponde a este producto'; end if;
      if v_qty<>1 then raise exception 'Los rewards solo pueden agregarse una vez'; end if;
      v_subtotal:=v_subtotal+v_item_extra; -- el producto es gratis, extras no.
    else
      v_subtotal:=v_subtotal+((v_product.price+v_item_extra)*v_qty);
    end if;
  end loop;

  v_delivery_fee:=case when p_fulfillment_type='delivery' then 39 else 0 end;
  v_total:=v_subtotal+v_delivery_fee;
  insert into public.orders(user_id,branch_id,fulfillment_type,delivery_address,delivery_reference,delivery_notes,payment_method,status,subtotal,delivery_fee,total)
  values(v_user,v_branch_id,p_fulfillment_type,v_address_text,case when p_fulfillment_type='delivery' then v_address.notes else null end,p_delivery_notes,p_payment_method,'preparing',v_subtotal,v_delivery_fee,v_total)
  returning public.orders.id,public.orders.order_number into v_order_id,v_order_number;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty:=greatest(1,least(20,coalesce((v_item->>'quantity')::int,1)));
    select p.* into v_product from public.products p where p.id=(v_item->>'product_id')::uuid;
    v_item_extra:=0;
    for v_custom in select * from jsonb_array_elements(coalesce(v_item->'customizations','[]'::jsonb)) loop
      select ct.* into v_template from public.customization_templates ct where ct.id=(v_custom->>'template_id')::uuid;
      select o into v_option from jsonb_array_elements(v_template.options) o where o->>'id'=v_custom->>'option_id' limit 1;
      v_custom_qty:=greatest(1,least(20,coalesce((v_custom->>'quantity')::int,1)));
      v_item_extra:=v_item_extra+(coalesce((v_option->>'price')::numeric,0)*v_custom_qty);
    end loop;
    v_voucher_id:=nullif(v_item->>'reward_voucher_id','')::uuid;
    if v_voucher_id is not null then
      update public.reward_vouchers rv set status='redeemed',redeemed_at=now() where rv.id=v_voucher_id and rv.user_id=v_user and rv.status='available' and rv.reward_type='spring_rolls';
      if not found then raise exception 'Este beneficio ya fue utilizado'; end if;
      insert into public.order_items(order_id,product_id,product_name,unit_price,quantity,customizations,item_note)
      values(v_order_id,v_product.id,v_product.name,v_item_extra,1,coalesce(v_item->'customizations','[]'::jsonb),left(coalesce(v_item->>'item_note',''),250));
    else
      insert into public.order_items(order_id,product_id,product_name,unit_price,quantity,customizations,item_note)
      values(v_order_id,v_product.id,v_product.name,v_product.price+v_item_extra,v_qty,coalesce(v_item->'customizations','[]'::jsonb),left(coalesce(v_item->>'item_note',''),250));
    end if;
  end loop;
  return query select v_order_id,v_order_number,v_total;
end;
$$;

revoke all on function public.create_order(text,text,uuid,text,text,jsonb) from public;
grant execute on function public.create_order(text,text,uuid,text,text,jsonb) to authenticated;
