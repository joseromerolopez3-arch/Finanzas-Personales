-- Cuentas Personales v2 — esquema normalizado.
-- No toca las tablas de la versión anterior (kv_store, resources): la app importa
-- automáticamente los datos de kv_store la primera vez que cada persona entra.

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table if not exists public.accounts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  icon text not null default '🏦',
  color text not null default '#2F6F5E',
  kind text not null default 'bank' check (kind in ('bank', 'savings', 'cash', 'card', 'investment', 'other')),
  opening_balance numeric(14, 2) not null default 0,
  opening_date date not null default current_date,
  position int not null default 0,
  archived boolean not null default false,
  import_mapping jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.categories (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('income', 'expense')),
  name text not null,
  icon text not null default '📦',
  color text not null default '#7A7A7A',
  position int not null default 0,
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.transactions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  type text not null check (type in ('income', 'expense', 'transfer', 'adjustment')),
  date date not null,
  amount numeric(14, 2) not null,
  account_id text not null,
  to_account_id text,
  category_id text,
  note text not null default '',
  source text not null default 'manual' check (source in ('manual', 'import', 'bank', 'recurring')),
  external_id text,
  to_external_id text,
  bank_description text,
  recurring_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists transactions_user_date on public.transactions (user_id, date desc);

create table if not exists public.budget_years (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  year int not null,
  mode text not null check (mode in ('category', 'savings')),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.budget_lines (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  year int not null,
  kind text not null check (kind in ('income', 'expense', 'savings')),
  category_id text,
  pattern text not null check (pattern in ('monthly', 'annual', 'months', 'custom')),
  base numeric(14, 2) not null default 0,
  amounts numeric(14, 2)[] not null check (cardinality(amounts) = 12),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.recurring (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  type text not null check (type in ('income', 'expense')),
  amount numeric(14, 2),
  category_id text,
  account_id text,
  frequency text not null check (frequency in ('once', 'monthly', 'yearly')),
  every_months int not null default 1,
  day int not null check (day between 1 and 31),
  month int check (month between 1 and 12),
  start_date date not null,
  end_date date,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.recurring_log (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  recurring_id text not null,
  period text not null,
  status text not null check (status in ('done', 'skipped')),
  transaction_id text,
  at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.rules (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  pattern text not null,
  category_id text not null,
  kind text check (kind in ('income', 'expense')),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null default 'me',
  name text not null default '',
  start_month text not null default to_char(current_date, 'YYYY-MM'),
  theme text not null default 'system',
  onboarded boolean not null default false,
  legacy_imported boolean not null default false,
  last_account_id text,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Row Level Security: cada persona solo ve y modifica sus propias filas.
do $$
declare t text;
begin
  foreach t in array array['accounts', 'categories', 'transactions', 'budget_years', 'budget_lines',
                           'recurring', 'recurring_log', 'rules', 'settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before update on public.%I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
