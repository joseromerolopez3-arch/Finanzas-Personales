-- Dos cargas simultáneas al entrar por primera vez creaban dos hogares. Un bloqueo por persona lo evita.
create or replace function public.ensure_household() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then raise exception 'No autenticado'; end if;
  -- Two simultaneous first loads must not create two households.
  perform pg_advisory_xact_lock(hashtextextended('ensure_household:' || uid::text, 0));
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
