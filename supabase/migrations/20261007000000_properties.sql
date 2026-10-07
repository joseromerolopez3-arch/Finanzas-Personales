-- Tipo de uso y viviendas (centros de coste).
--
-- · households.kind: 'personal' (finanzas de una sola persona) o 'shared' (hogar compartido).
--   Una persona puede tener los dos: el suyo personal y el hogar en común.
-- · properties: viviendas del hogar. Cada movimiento, pago programado y línea de presupuesto
--   puede ir a una vivienda (property_id) o a «General» (null).

alter table public.households add column if not exists kind text not null default 'shared';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'households_kind_check') then
    alter table public.households add constraint households_kind_check check (kind in ('personal', 'shared'));
  end if;
end $$;

create table if not exists public.properties (
  household_id uuid not null references public.households (id) on delete cascade,
  id text not null,
  name text not null,
  icon text not null default '🏠',
  position integer not null default 0,
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (household_id, id)
);

alter table public.transactions add column if not exists property_id text;
alter table public.budget_lines add column if not exists property_id text;
alter table public.recurring add column if not exists property_id text;

alter table public.properties enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'properties' and policyname = 'household rows') then
    create policy "household rows" on public.properties for all to authenticated
      using (household_id in (select private.my_households()))
      with check (household_id in (select private.my_households()));
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'touch' and tgrelid = 'public.properties'::regclass) then
    create trigger touch before insert or update on public.properties for each row execute function public.touch_row();
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'properties') then
    alter publication supabase_realtime add table public.properties;
  end if;
end $$;

-- Crear un hogar más (p. ej. el personal además del compartido). No cambia el hogar activo.
create or replace function public.create_household(hname text, hkind text default 'shared') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  if hkind not in ('personal', 'shared') then raise exception 'Tipo de hogar no válido'; end if;
  if (select count(*) from public.household_members where user_id = uid) >= 5 then
    raise exception 'Has llegado al máximo de hogares';
  end if;
  insert into public.households (name, kind, created_by)
    values (coalesce(nullif(trim(hname), ''), 'Mi hogar'), hkind, uid) returning id into hid;
  insert into public.household_members (household_id, user_id, role, email, name)
    values (hid, uid, 'owner', auth.jwt() ->> 'email',
            coalesce((select m.name from public.household_members m where m.user_id = uid and m.name <> '' limit 1), ''));
  return hid;
end $$;

-- Al unirse a un hogar ya no se borran los hogares personales propios aunque estén vacíos
-- (quien elige «personal + hogar» los conserva para configurarlos después).
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
    join public.households h on h.id = m.household_id
    where m.user_id = uid and m.household_id <> inv.household_id and h.kind = 'shared'
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

revoke execute on function public.create_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
