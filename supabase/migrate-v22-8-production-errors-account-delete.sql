-- KYO v22.8 — eliminación de cuenta de producción
-- Ejecutar UNA sola vez en la base actual.
--
-- Objetivos:
-- 1) No permitir borrar una cuenta con pedidos activos.
-- 2) Conservar pedidos históricos del restaurante sin ligarlos al usuario.
-- 3) Eliminar/anular datos personales de entrega del historial.
-- 4) Borrar perfil, direcciones, rewards y autenticación del cliente.

alter table public.orders
  alter column user_id drop not null;

alter table public.orders
  drop constraint if exists orders_user_id_fkey;

alter table public.orders
  add constraint orders_user_id_fkey
  foreign key (user_id)
  references public.profiles(id)
  on delete set null;


create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is null then
    raise exception 'Debes iniciar sesión';
  end if;

  -- No borrar mientras Cocina/Reparto todavía necesiten identificar al cliente.
  if exists(
    select 1
    from public.orders o
    where o.user_id=v_user
      and o.status in ('received','accepted','preparing','ready','on_the_way')
  ) then
    raise exception 'No puedes eliminar tu cuenta mientras tengas un pedido activo. Espera a que termine o contacta a KYO.';
  end if;

  -- El restaurante conserva importes, productos, fecha, sucursal y número de pedido,
  -- pero se quitan datos personales de entrega del historial.
  update public.orders
  set delivery_address=null,
      delivery_reference=null,
      delivery_notes=null,
      updated_at=now()
  where user_id=v_user;

  -- Estas tablas también se eliminarían por cascada al borrar auth.users/profile,
  -- pero se hace explícito para que la intención de privacidad sea clara.
  delete from public.reward_vouchers where user_id=v_user;
  delete from public.addresses where user_id=v_user;

  -- El perfil se elimina por cascade desde auth.users.
  -- El FK de orders pasa user_id a NULL y conserva el registro histórico.
  delete from auth.users where id=v_user;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
