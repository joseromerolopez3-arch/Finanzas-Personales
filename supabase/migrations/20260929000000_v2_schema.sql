-- Cuentas Personales v2 — esquema normalizado con hogares compartidos.
-- Convive con la tabla `resources` (sección Formación) de la versión anterior.
--
-- Modelo: los datos (cuentas, movimientos, presupuesto…) pertenecen a un HOGAR.
-- Cada persona tiene su propio hogar al entrar y puede invitar a otras con un código.
-- Las preferencias personales (nombre, tema, hogar activo) van en `settings`, por usuario.

-- ---------- hogares ----------
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mi hogar',
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  email text,
  name text not null default '',
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index if not exists household_members_user on public.household_members (user_id);

create table if not exists public.household_invites (
  code text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);
create index if not exists household_invites_household on public.household_invites (household_id);

-- Hogares de la persona que hace la consulta (security definer: evita recursión en RLS).
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.my_households() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.household_members where user_id = (select auth.uid())
$$;

-- ---------- datos del hogar ----------
create or replace function public.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end $$;

create table if not exists public.accounts (
  household_id uuid not null references public.households (id) on delete cascade,
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
  updated_by uuid,
  primary key (household_id, id)
);

create table if not exists public.categories (
  household_id uuid not null references public.households (id) on delete cascade,
  id text not null,
  kind text not null check (kind in ('income', 'expense')),
  name text not null,
  icon text not null default '📦',
  color text not null default '#7A7A7A',
  position int not null default 0,
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (household_id, id)
);

create table if not exists public.transactions (
  household_id uuid not null references public.households (id) on delete cascade,
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
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (household_id, id)
);
create index if not exists transactions_household_date on public.transactions (household_id, date desc);

create table if not exists public.budget_years (
  household_id uuid not null references public.households (id) on delete cascade,
  id text not null,
  year int not null,
  mode text not null check (mode in ('category', 'savings')),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (household_id, id)
);

create table if not exists public.budget_lines (
  household_id uuid not null references public.households (id) on delete cascade,
  id text not null,
  year int not null,
  kind text not null check (kind in ('income', 'expense', 'savings')),
  category_id text,
  pattern text not null check (pattern in ('monthly', 'annual', 'months', 'custom')),
  base numeric(14, 2) not null default 0,
  amounts numeric(14, 2)[] not null check (cardinality(amounts) = 12),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (household_id, id)
);

create table if not exists public.recurring (
  household_id uuid not null references public.households (id) on delete cascade,
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
  updated_by uuid,
  primary key (household_id, id)
);

create table if not exists public.recurring_log (
  household_id uuid not null references public.households (id) on delete cascade,
  id text not null,
  recurring_id text not null,
  period text not null,
  status text not null check (status in ('done', 'skipped')),
  transaction_id text,
  at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (household_id, id)
);

create table if not exists public.rules (
  household_id uuid not null references public.households (id) on delete cascade,
  id text not null,
  pattern text not null,
  category_id text not null,
  kind text check (kind in ('income', 'expense')),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (household_id, id)
);

-- ---------- preferencias personales ----------
create table if not exists public.settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null default 'me',
  household_id uuid references public.households (id) on delete set null,
  name text not null default '',
  start_month text not null default to_char(current_date, 'YYYY-MM'),
  theme text not null default 'system',
  onboarded boolean not null default false,
  last_account_id text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (user_id, id)
);

-- ---------- seguridad (RLS) ----------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

drop policy if exists "members read" on public.households;
create policy "members read" on public.households for select to authenticated
  using (id in (select private.my_households()));
drop policy if exists "owner renames" on public.households;
create policy "owner renames" on public.households for update to authenticated
  using (exists (select 1 from public.household_members m where m.household_id = households.id and m.user_id = (select auth.uid()) and m.role = 'owner'));

drop policy if exists "members read" on public.household_members;
create policy "members read" on public.household_members for select to authenticated
  using (household_id in (select private.my_households()));
drop policy if exists "own row" on public.household_members;
create policy "own row" on public.household_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "members read" on public.household_invites;
create policy "members read" on public.household_invites for select to authenticated
  using (household_id in (select private.my_households()));

do $$
declare t text;
begin
  foreach t in array array['accounts', 'categories', 'transactions', 'budget_years', 'budget_lines',
                           'recurring', 'recurring_log', 'rules']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "household rows" on public.%I', t);
    execute format('create policy "household rows" on public.%I for all to authenticated
                    using (household_id in (select private.my_households()))
                    with check (household_id in (select private.my_households()))', t);
    execute format('drop trigger if exists touch on public.%I', t);
    execute format('create trigger touch before insert or update on public.%I
                    for each row execute function public.touch_row()', t);
  end loop;
end $$;

alter table public.settings enable row level security;
drop policy if exists "own rows" on public.settings;
create policy "own rows" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop trigger if exists touch on public.settings;
create trigger touch before insert or update on public.settings for each row execute function public.touch_row();

-- ---------- operaciones de hogar (RPC) ----------

-- Hogar activo de la persona: el de sus preferencias si sigue siendo miembro; si no, el más antiguo;
-- y si no tiene ninguno, se crea uno propio.
create or replace function public.ensure_household() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  select s.household_id into hid from public.settings s
    join public.household_members m on m.household_id = s.household_id and m.user_id = uid
    where s.user_id = uid and s.id = 'me';
  if hid is null then
    select household_id into hid from public.household_members where user_id = uid order by joined_at limit 1;
  end if;
  if hid is null then
    insert into public.households (name, created_by) values ('Mi hogar', uid) returning id into hid;
    insert into public.household_members (household_id, user_id, role, email)
      values (hid, uid, 'owner', auth.jwt() ->> 'email');
  end if;
  return hid;
end $$;

create or replace function public.create_invite(hid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not exists (select 1 from public.household_members where household_id = hid and user_id = auth.uid()) then
    raise exception 'No perteneces a este hogar';
  end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.household_invites (code, household_id, created_by) values (c, hid, auth.uid());
  return c;
end $$;

-- Datos básicos de una invitación, para confirmar antes de unirse.
create or replace function public.invite_info(invite text) returns table (household_name text, invited_by text)
language sql stable security definer set search_path = '' as $$
  select h.name, coalesce(nullif(m.name, ''), m.email)
  from public.household_invites i
  join public.households h on h.id = i.household_id
  left join public.household_members m on m.household_id = i.household_id and m.user_id = i.created_by
  where i.code = upper(trim(invite)) and i.used_by is null and i.expires_at > now()
$$;

-- Unirse con un código (de un solo uso). Los hogares propios vacíos se eliminan.
create or replace function public.join_household(invite text, display_name text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  inv public.household_invites;
  old uuid;
begin
  select * into inv from public.household_invites
    where code = upper(trim(invite)) and used_by is null and expires_at > now() for update;
  if not found then raise exception 'El código no es válido o ha caducado'; end if;
  insert into public.household_members (household_id, user_id, role, email, name)
    values (inv.household_id, uid, 'member', auth.jwt() ->> 'email', coalesce(display_name, ''))
    on conflict (household_id, user_id) do nothing;
  update public.household_invites set used_by = uid, used_at = now() where code = inv.code;
  for old in
    select m.household_id from public.household_members m
    where m.user_id = uid and m.household_id <> inv.household_id
      and not exists (select 1 from public.household_members o where o.household_id = m.household_id and o.user_id <> uid)
      and not exists (select 1 from public.transactions t where t.household_id = m.household_id)
      and not exists (select 1 from public.accounts a where a.household_id = m.household_id)
  loop
    delete from public.households where id = old;
  end loop;
  insert into public.settings (user_id, id, household_id) values (uid, 'me', inv.household_id)
    on conflict (user_id, id) do update set household_id = excluded.household_id;
  return inv.household_id;
end $$;

-- Salir de un hogar. Si era el último miembro, el hogar y sus datos se borran;
-- si era titular, la titularidad pasa al miembro más antiguo.
create or replace function public.leave_household(hid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  delete from public.household_members where household_id = hid and user_id = uid;
  if not exists (select 1 from public.household_members where household_id = hid) then
    delete from public.households where id = hid;
  elsif not exists (select 1 from public.household_members where household_id = hid and role = 'owner') then
    update public.household_members set role = 'owner'
      where household_id = hid and user_id = (select user_id from public.household_members where household_id = hid order by joined_at limit 1);
  end if;
  update public.settings set household_id = null where user_id = uid and household_id = hid;
end $$;

create or replace function public.remove_member(hid uuid, member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.household_members where household_id = hid and user_id = auth.uid() and role = 'owner') then
    raise exception 'Solo la persona titular puede quitar miembros';
  end if;
  if member = auth.uid() then raise exception 'Para salir tú, usa «Salir del hogar»'; end if;
  delete from public.household_members where household_id = hid and user_id = member;
end $$;

revoke execute on function private.my_households, public.ensure_household, public.create_invite, public.invite_info,
  public.join_household, public.leave_household, public.remove_member from public, anon;
grant execute on function private.my_households, public.ensure_household, public.create_invite, public.invite_info,
  public.join_household, public.leave_household, public.remove_member to authenticated;

-- ---------- tiempo real (ver al instante lo que apuntan los demás) ----------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['accounts', 'categories', 'transactions', 'budget_years', 'budget_lines',
                           'recurring', 'recurring_log', 'rules', 'household_members']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
