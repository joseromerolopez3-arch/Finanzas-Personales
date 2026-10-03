-- Conexión bancaria con Enable Banking: sincronización diaria y conciliación automática.

-- Movimientos creados por el banco pendientes de revisar.
alter table public.transactions add column if not exists needs_review boolean not null default false;

-- Conexión (autorización PSD2) de un banco para un hogar.
create table if not exists public.bank_links (
  id text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  aspsp_name text not null,
  aspsp_country text not null default 'ES',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'error')),
  valid_until timestamptz,
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bank_links_household on public.bank_links (household_id);

-- Cuentas del banco y la cuenta de la app con la que se sincroniza cada una.
create table if not exists public.bank_accounts (
  id text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  link_id text not null references public.bank_links (id) on delete cascade,
  uid text not null,
  identification_hash text,
  name text not null default '',
  iban_tail text,
  currency text default 'EUR',
  account_id text,
  sync_from date,
  init_opening boolean not null default false,
  balance numeric(14, 2),
  balance_date date,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists bank_accounts_household on public.bank_accounts (household_id);
create index if not exists bank_accounts_link on public.bank_accounts (link_id);

-- Solo para la función del servidor (sin políticas: nadie más puede leerlas).
create table if not exists public.bank_secrets (
  link_id text primary key references public.bank_links (id) on delete cascade,
  session_id text not null
);
create table if not exists public.bank_auth_requests (
  state text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  link_id text,
  aspsp_name text not null,
  aspsp_country text not null,
  created_at timestamptz not null default now()
);
create index if not exists bank_auth_requests_household on public.bank_auth_requests (household_id);
create index if not exists bank_auth_requests_user on public.bank_auth_requests (user_id);
create table if not exists public.bank_config (
  id int primary key default 1 check (id = 1),
  cron_token text not null
);
insert into public.bank_config (id, cron_token)
values (1, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

alter table public.bank_links enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_secrets enable row level security;
alter table public.bank_auth_requests enable row level security;
alter table public.bank_config enable row level security;
revoke all on public.bank_secrets, public.bank_auth_requests, public.bank_config from anon, authenticated;

drop policy if exists "household reads" on public.bank_links;
create policy "household reads" on public.bank_links for select to authenticated
  using (household_id in (select private.my_households()));
drop policy if exists "household reads" on public.bank_accounts;
create policy "household reads" on public.bank_accounts for select to authenticated
  using (household_id in (select private.my_households()));

-- Tiempo real para que la app vea el estado de la sincronización.
do $$
declare t text;
begin
  foreach t in array array['bank_links', 'bank_accounts']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Sincronización diaria (05:20 UTC ≈ 7:20 en verano / 6:20 en invierno en España) y limpieza.
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule('bank-sync-daily', '20 5 * * *', $job$
  select net.http_post(
    url := 'https://snxtumznncolfqoxeayn.supabase.co/functions/v1/bank',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-token', (select cron_token from public.bank_config where id = 1)),
    body := '{"action": "sync-all"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);

select cron.schedule('bank-auth-cleanup', '40 4 * * *', $job$
  delete from public.bank_auth_requests where created_at < now() - interval '1 day';
$job$);
