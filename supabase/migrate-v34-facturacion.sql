-- KYO Sushi - v34 Facturación desde checkout + bandeja en panel general
-- Ejecutar una sola vez en Supabase SQL Editor antes de desplegar cliente/panel.

begin;

create table if not exists public.billing_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Mis datos fiscales',
  rfc text not null,
  legal_name text not null,
  postal_code text not null,
  tax_regime text not null,
  cfdi_use text not null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_profiles_user_id_idx
  on public.billing_profiles(user_id, updated_at desc);

alter table public.billing_profiles enable row level security;

drop policy if exists "billing profiles own select" on public.billing_profiles;
create policy "billing profiles own select"
on public.billing_profiles for select
using (auth.uid() = user_id);

revoke all on table public.billing_profiles from anon;
revoke all on table public.billing_profiles from authenticated;
grant select on table public.billing_profiles to authenticated;

alter table public.orders
  add column if not exists invoice_requested boolean not null default false,
  add column if not exists invoice_profile_id uuid references public.billing_profiles(id) on delete set null,
  add column if not exists invoice_rfc text,
  add column if not exists invoice_legal_name text,
  add column if not exists invoice_postal_code text,
  add column if not exists invoice_tax_regime text,
  add column if not exists invoice_cfdi_use text,
  add column if not exists invoice_email text,
  add column if not exists invoice_status text,
  add column if not exists invoice_requested_at timestamptz,
  add column if not exists invoice_sent_at timestamptz;

alter table public.orders
  drop constraint if exists orders_invoice_status_check;
alter table public.orders
  add constraint orders_invoice_status_check
  check (invoice_status is null or invoice_status in ('requested','sent'));

create index if not exists orders_invoice_requested_idx
  on public.orders(invoice_requested, invoice_status, created_at desc);

-- Guarda/edita un perfil fiscal opcional y deja una COPIA de los datos en el pedido.
-- La copia evita que editar un perfil después cambie los datos de una solicitud ya hecha.
create or replace function public.set_order_invoice_request(
  p_order_id uuid,
  p_requested boolean,
  p_profile_id uuid,
  p_save_profile boolean,
  p_label text,
  p_rfc text,
  p_legal_name text,
  p_postal_code text,
  p_tax_regime text,
  p_cfdi_use text,
  p_email text
)
returns table(saved_profile_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_profile_id uuid := null;
  v_rfc text;
  v_legal_name text;
  v_postal_code text;
  v_tax_regime text;
  v_cfdi_use text;
  v_email text;
  v_label text;
  v_existing_status text;
begin
  if v_user is null then
    raise exception 'Debes iniciar sesión';
  end if;

  if not exists(
    select 1 from public.orders o
    where o.id = p_order_id and o.user_id = v_user
  ) then
    raise exception 'Pedido inválido';
  end if;

  select o.invoice_status into v_existing_status
  from public.orders o
  where o.id = p_order_id;

  if coalesce(p_requested,false) = false then
    if v_existing_status = 'sent' then
      raise exception 'Esta factura ya fue marcada como enviada';
    end if;

    update public.orders
    set invoice_requested=false,
        invoice_profile_id=null,
        invoice_rfc=null,
        invoice_legal_name=null,
        invoice_postal_code=null,
        invoice_tax_regime=null,
        invoice_cfdi_use=null,
        invoice_email=null,
        invoice_status=null,
        invoice_requested_at=null,
        invoice_sent_at=null
    where id=p_order_id and user_id=v_user;

    return query select null::uuid;
    return;
  end if;

  v_rfc := upper(regexp_replace(trim(coalesce(p_rfc,'')), '\s+', '', 'g'));
  v_legal_name := trim(coalesce(p_legal_name,''));
  v_postal_code := trim(coalesce(p_postal_code,''));
  v_tax_regime := trim(coalesce(p_tax_regime,''));
  v_cfdi_use := trim(coalesce(p_cfdi_use,''));
  v_email := lower(trim(coalesce(p_email,'')));
  v_label := left(coalesce(nullif(trim(p_label),''),'Mis datos fiscales'),80);

  if length(v_rfc) not in (12,13) then raise exception 'RFC inválido'; end if;
  if v_legal_name = '' then raise exception 'Falta nombre o razón social'; end if;
  if v_postal_code !~ '^[0-9]{5}$' then raise exception 'Código postal fiscal inválido'; end if;
  if v_tax_regime = '' then raise exception 'Falta régimen fiscal'; end if;
  if v_cfdi_use = '' then raise exception 'Falta uso de CFDI'; end if;
  if v_email = '' or position('@' in v_email) < 2 then raise exception 'Correo de facturación inválido'; end if;

  if coalesce(p_save_profile,false) then
    if p_profile_id is not null then
      update public.billing_profiles bp
      set label=v_label,
          rfc=v_rfc,
          legal_name=v_legal_name,
          postal_code=v_postal_code,
          tax_regime=v_tax_regime,
          cfdi_use=v_cfdi_use,
          email=v_email,
          updated_at=now()
      where bp.id=p_profile_id and bp.user_id=v_user
      returning bp.id into v_profile_id;

      if v_profile_id is null then
        raise exception 'Datos fiscales guardados inválidos';
      end if;
    else
      insert into public.billing_profiles(user_id,label,rfc,legal_name,postal_code,tax_regime,cfdi_use,email)
      values(v_user,v_label,v_rfc,v_legal_name,v_postal_code,v_tax_regime,v_cfdi_use,v_email)
      returning id into v_profile_id;
    end if;
  elsif p_profile_id is not null then
    -- Si eligió un perfil existente pero no quiere guardar cambios, sólo validamos propiedad.
    if not exists(select 1 from public.billing_profiles bp where bp.id=p_profile_id and bp.user_id=v_user) then
      raise exception 'Datos fiscales guardados inválidos';
    end if;
    v_profile_id := p_profile_id;
  end if;

  update public.orders
  set invoice_requested=true,
      invoice_profile_id=v_profile_id,
      invoice_rfc=v_rfc,
      invoice_legal_name=v_legal_name,
      invoice_postal_code=v_postal_code,
      invoice_tax_regime=v_tax_regime,
      invoice_cfdi_use=v_cfdi_use,
      invoice_email=v_email,
      invoice_status='requested',
      invoice_requested_at=coalesce(invoice_requested_at,now()),
      invoice_sent_at=null
  where id=p_order_id and user_id=v_user;

  return query select v_profile_id;
end;
$$;

revoke all on function public.set_order_invoice_request(uuid,boolean,uuid,boolean,text,text,text,text,text,text,text) from public;
grant execute on function public.set_order_invoice_request(uuid,boolean,uuid,boolean,text,text,text,text,text,text,text) to authenticated;

-- Sólo el administrador GENERAL puede marcar una factura como enviada/reabrirla.
create or replace function public.admin_set_invoice_status(
  p_order_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'Sin permisos';
  end if;

  if p_status not in ('requested','sent') then
    raise exception 'Estado de factura inválido';
  end if;

  update public.orders
  set invoice_status=p_status,
      invoice_sent_at=case when p_status='sent' then now() else null end
  where id=p_order_id and invoice_requested=true;

  if not found then
    raise exception 'Solicitud de factura no encontrada';
  end if;
end;
$$;

revoke all on function public.admin_set_invoice_status(uuid,text) from public;
grant execute on function public.admin_set_invoice_status(uuid,text) to authenticated;

commit;

-- Verificación opcional:
-- select id,user_id,label,rfc,legal_name,postal_code,tax_regime,cfdi_use,email from public.billing_profiles order by updated_at desc;
-- select order_number,invoice_requested,invoice_rfc,invoice_legal_name,invoice_email,invoice_status from public.orders where invoice_requested=true order by created_at desc;
