-- La función auxiliar de RLS no necesita estar expuesta como RPC: se mueve a un esquema privado.
-- (Las políticas la referencian por OID, así que siguen funcionando.) Idempotente.
create schema if not exists private;
grant usage on schema private to authenticated;
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'my_households') then
    alter function public.my_households() set schema private;
  end if;
end $$;

-- Índices para claves foráneas (recomendación del asesor de rendimiento).
create index if not exists settings_household on public.settings (household_id);
create index if not exists households_created_by on public.households (created_by);
create index if not exists household_invites_created_by on public.household_invites (created_by);
create index if not exists household_invites_used_by on public.household_invites (used_by);
