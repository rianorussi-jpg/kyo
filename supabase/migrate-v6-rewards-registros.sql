-- KYO v6: Rewards canjeables + tarjeta de 6 pedidos.
-- Ejecuta UNA VEZ en Supabase > SQL Editor sobre la base actual.

alter table public.profiles add column if not exists reward_order_stamps integer not null default 0;

-- El producto demo usado por el beneficio de 250 puntos.
update public.products set name='4 Spring Rolls' where slug='spring-rolls';

create table if not exists public.reward_vouchers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_type text not null check (reward_type in ('spring_rolls','free_roll')),
  status text not null default 'available' check (status in ('available','redeemed','expired')),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz
);

alter table public.reward_vouchers enable row level security;
drop policy if exists "reward vouchers own select" on public.reward_vouchers;
create policy "reward vouchers own select" on public.reward_vouchers for select using (auth.uid()=user_id or public.is_admin(auth.uid()));
drop policy if exists "admins manage reward vouchers" on public.reward_vouchers;
create policy "admins manage reward vouchers" on public.reward_vouchers for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

grant select on public.reward_vouchers to authenticated;

-- Evita que el navegador pueda fabricarse puntos o sellos directamente.
revoke update(reward_points,reward_order_stamps,is_admin,kitchen_branch) on public.profiles from authenticated;

create or replace function public.award_rewards_on_delivery()
returns trigger
language plpgsql
security definer
set search_path=public as $$
begin
  if new.status='delivered' and old.status is distinct from 'delivered' and new.rewards_awarded=false then
    update public.profiles
      set reward_points=reward_points+floor(new.subtotal)::int,
          reward_order_stamps=reward_order_stamps+1
      where id=new.user_id;
    new.rewards_awarded:=true;
  end if;
  return new;
end; $$;

create or replace function public.redeem_spring_rolls_reward()
returns uuid
language plpgsql
security definer
set search_path=public as $$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Debes iniciar sesión'; end if;
  update public.profiles set reward_points=reward_points-250
    where id=v_user and reward_points>=250;
  if not found then raise exception 'No tienes 250 puntos disponibles'; end if;
  insert into public.reward_vouchers(user_id,reward_type) values(v_user,'spring_rolls') returning id into v_id;
  return v_id;
end; $$;

create or replace function public.redeem_six_orders_reward()
returns uuid
language plpgsql
security definer
set search_path=public as $$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Debes iniciar sesión'; end if;
  update public.profiles set reward_order_stamps=reward_order_stamps-6
    where id=v_user and reward_order_stamps>=6;
  if not found then raise exception 'Aún no completas 6 pedidos'; end if;
  insert into public.reward_vouchers(user_id,reward_type) values(v_user,'free_roll') returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.redeem_spring_rolls_reward() from public;
revoke all on function public.redeem_six_orders_reward() from public;
grant execute on function public.redeem_spring_rolls_reward() to authenticated;
grant execute on function public.redeem_six_orders_reward() to authenticated;
