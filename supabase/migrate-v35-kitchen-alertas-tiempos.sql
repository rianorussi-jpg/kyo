-- KYO v35 · alertas obligatorias por pedido + tiempo real de preparación
-- Ejecutar una sola vez en Supabase SQL Editor antes de desplegar Cocina/Panel.

alter table public.orders
  add column if not exists kitchen_started_at timestamptz,
  add column if not exists kitchen_acknowledged_at timestamptz,
  add column if not exists kitchen_ready_at timestamptz,
  add column if not exists kitchen_prep_seconds integer;

alter table public.orders
  drop constraint if exists orders_kitchen_prep_seconds_check;

alter table public.orders
  add constraint orders_kitchen_prep_seconds_check
  check (kitchen_prep_seconds is null or kitchen_prep_seconds >= 0);

create or replace function public.kyo_track_kitchen_timing()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- El cronómetro comienza exactamente cuando el pedido entra por primera vez a Preparando.
  if new.status = 'preparing' and new.kitchen_started_at is null then
    if tg_op = 'INSERT' then
      new.kitchen_started_at := now();
    elsif old.status is distinct from 'preparing' then
      new.kitchen_started_at := now();
    end if;
  end if;

  -- Se congela cuando el pedido cambia a Listo y se guarda la duración en segundos.
  if tg_op = 'UPDATE'
     and new.status = 'ready'
     and old.status is distinct from 'ready' then
    if new.kitchen_started_at is null then
      new.kitchen_started_at := coalesce(old.kitchen_started_at, new.created_at, now());
    end if;

    new.kitchen_ready_at := now();
    new.kitchen_prep_seconds := greatest(
      0,
      floor(extract(epoch from (new.kitchen_ready_at - new.kitchen_started_at)))::integer
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_kyo_track_kitchen_timing on public.orders;
create trigger trg_kyo_track_kitchen_timing
before insert or update of status on public.orders
for each row
execute function public.kyo_track_kitchen_timing();

-- Los pedidos que ya estén en Preparando al momento de instalar esta migración
-- arrancan su cronómetro desde este momento. No se inventan tiempos históricos.
update public.orders
set kitchen_started_at = now()
where status = 'preparing'
  and kitchen_started_at is null;
