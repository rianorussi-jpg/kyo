-- KYO v24 — Panel limitado por sucursal
-- IMPORTANTE:
-- 1) Primero crea en Supabase > Authentication > Users:
--      infozakia@kyosushi.mx
--      infomilenio@kyosushi.mx
--    con la contraseña que KYO quiera usar.
-- 2) Después ejecuta TODO este archivo en Supabase SQL Editor.
--
-- La cuenta general info@kyosushi.mx conserva acceso total porque panel_branch queda NULL.
-- Las cuentas de sucursal quedan en modo lectura para pedidos/registros y SOLO pueden
-- cambiar product_branch_availability de su propia sucursal.

alter table public.profiles
  add column if not exists panel_branch text null references public.branches(id) on delete set null;

create index if not exists profiles_panel_branch_idx on public.profiles(panel_branch);

-- En el backend, is_admin() pasa a significar "administrador GENERAL".
-- Así ninguna política antigua de administración total se hereda accidentalmente
-- a una cuenta limitada de sucursal.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.profiles p
    where p.id=uid
      and p.is_admin=true
      and p.panel_branch is null
  );
$$;

create or replace function public.panel_branch_for(uid uuid)
returns text
language sql
stable
security definer
set search_path=public
as $$
  select p.panel_branch
  from public.profiles p
  where p.id=uid
    and p.is_admin=true
  limit 1;
$$;

create or replace function public.has_panel_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.profiles p
    where p.id=uid and p.is_admin=true
  );
$$;

revoke all on function public.panel_branch_for(uuid) from public;
grant execute on function public.panel_branch_for(uuid) to authenticated;
revoke all on function public.has_panel_access(uuid) from public;
grant execute on function public.has_panel_access(uuid) to authenticated;

-- Configura las dos cuentas por correo.
-- Si alguno de los usuarios todavía no existe en Authentication, esa fila no se modifica.
update public.profiles p
set is_admin=true,
    panel_branch='zakia',
    full_name=coalesce(nullif(p.full_name,''),'KYO Zákia'),
    updated_at=now()
from auth.users u
where p.id=u.id
  and lower(u.email)=lower('infozakia@kyosushi.mx');

update public.profiles p
set is_admin=true,
    panel_branch='milenio',
    full_name=coalesce(nullif(p.full_name,''),'KYO Milenio'),
    updated_at=now()
from auth.users u
where p.id=u.id
  and lower(u.email)=lower('infomilenio@kyosushi.mx');

-- Asegura que la cuenta general, si existe, no quede limitada a una sucursal.
update public.profiles p
set is_admin=true,
    panel_branch=null,
    updated_at=now()
from auth.users u
where p.id=u.id
  and lower(u.email)=lower('info@kyosushi.mx');

-- ===== PEDIDOS =====
-- Clientes normales ven los suyos. Admin general ve todos.
-- Los paneles de sucursal NO aprovechan accidentalmente "orders own select".
drop policy if exists "orders own select" on public.orders;
create policy "orders own select"
on public.orders for select
using (
  (auth.uid()=user_id and not public.has_panel_access(auth.uid()))
  or public.is_admin(auth.uid())
);

drop policy if exists "branch panel orders select" on public.orders;
create policy "branch panel orders select"
on public.orders for select
using (
  public.panel_branch_for(auth.uid()) is not null
  and branch_id=public.panel_branch_for(auth.uid())
);

-- Actualizar estados desde Panel queda reservado al administrador general.
-- Cocina conserva sus propias políticas existentes por kitchen_branch.
drop policy if exists "admins update orders" on public.orders;
create policy "admins update orders"
on public.orders for update
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- ===== ITEMS DE PEDIDOS =====
drop policy if exists "order items own select" on public.order_items;
create policy "order items own select"
on public.order_items for select
using (
  exists(
    select 1
    from public.orders o
    where o.id=order_id
      and (
        (o.user_id=auth.uid() and not public.has_panel_access(auth.uid()))
        or public.is_admin(auth.uid())
      )
  )
);

drop policy if exists "branch panel order items select" on public.order_items;
create policy "branch panel order items select"
on public.order_items for select
using (
  exists(
    select 1
    from public.orders o
    where o.id=order_id
      and public.panel_branch_for(auth.uid()) is not null
      and o.branch_id=public.panel_branch_for(auth.uid())
  )
);

-- ===== DATOS BÁSICOS DEL CLIENTE PARA PEDIDOS DE SUCURSAL =====
drop policy if exists "branch panel customer profile read" on public.profiles;
create policy "branch panel customer profile read"
on public.profiles for select
using (
  id=auth.uid()
  or public.is_admin(auth.uid())
  or (
    public.panel_branch_for(auth.uid()) is not null
    and exists(
      select 1
      from public.orders o
      where o.user_id=profiles.id
        and o.branch_id=public.panel_branch_for(auth.uid())
    )
  )
);

-- ===== DISPONIBILIDAD DE PRODUCTOS =====
-- La política antigua "admins manage..." ahora solo permite al admin general,
-- porque is_admin() ya excluye panel_branch.
drop policy if exists "admins manage product branch availability" on public.product_branch_availability;
create policy "admins manage product branch availability"
on public.product_branch_availability for all
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- Cuenta de sucursal: puede INSERT/UPDATE únicamente SU propia fila.
drop policy if exists "branch panel insert own product availability" on public.product_branch_availability;
create policy "branch panel insert own product availability"
on public.product_branch_availability for insert
with check (
  public.panel_branch_for(auth.uid()) is not null
  and branch_id=public.panel_branch_for(auth.uid())
);

drop policy if exists "branch panel update own product availability" on public.product_branch_availability;
create policy "branch panel update own product availability"
on public.product_branch_availability for update
using (
  public.panel_branch_for(auth.uid()) is not null
  and branch_id=public.panel_branch_for(auth.uid())
)
with check (
  public.panel_branch_for(auth.uid()) is not null
  and branch_id=public.panel_branch_for(auth.uid())
);

-- No se agrega DELETE para sucursales.
-- No se agrega acceso a products/categories/templates/settings/storage:
-- esas acciones siguen siendo exclusivamente del admin general.

-- Verificación útil después de ejecutar:
select
  u.email,
  p.is_admin,
  p.panel_branch
from auth.users u
join public.profiles p on p.id=u.id
where lower(u.email) in (
  lower('info@kyosushi.mx'),
  lower('infozakia@kyosushi.mx'),
  lower('infomilenio@kyosushi.mx')
)
order by u.email;
