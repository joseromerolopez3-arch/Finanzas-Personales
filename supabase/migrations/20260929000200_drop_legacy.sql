-- Los datos de la primera versión eran de prueba: se elimina su tabla y el marcador de importación.
drop table if exists public.kv_store;
alter table public.settings drop column if exists legacy_imported;
