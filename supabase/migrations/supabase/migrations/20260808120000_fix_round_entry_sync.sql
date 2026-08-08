-- ============================================================
-- CRITICAL FIX: keep legacy round_countries and round_entries
-- synchronized in BOTH directions.
--
-- submit_vote validates ballots against round_entries, while
-- parts of the existing admin still write round_countries.
-- ============================================================


-- ------------------------------------------------------------
-- 1. BACKFILL ANY COUNTRIES THAT WERE ADDED AFTER THE ORIGINAL
--    round_entries MIGRATION
-- ------------------------------------------------------------

insert into public.round_entries (
  round_id,
  entry_type,
  entry_key,
  country_code,
  custom_name,
  display_order
)
select
  rc.round_id,
  'country',
  rc.country_code,
  rc.country_code,
  null,
  rc.display_order
from public.round_countries rc
on conflict (round_id, entry_key)
do update set
  country_code = excluded.country_code,
  display_order = excluded.display_order,
  updated_at = now();


-- ------------------------------------------------------------
-- 2. LEGACY round_countries -> round_entries SYNC
--
-- This is a compatibility bridge while the frontend is migrated
-- to round_entries completely.
-- ------------------------------------------------------------

create or replace function public.round_countries_sync_entries()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin

  if tg_op = 'DELETE' then
    delete from public.round_entries
    where
      round_id = old.round_id
      and entry_type = 'country'
      and country_code = old.country_code;

    return old;
  end if;

  insert into public.round_entries (
    round_id,
    entry_type,
    entry_key,
    country_code,
    custom_name,
    display_order
  )
  values (
    new.round_id,
    'country',
    new.country_code,
    new.country_code,
    null,
    new.display_order
  )
  on conflict (round_id, entry_key)
  do update set
    country_code = excluded.country_code,
    display_order = excluded.display_order,
    updated_at = now();

  return new;
end;
$$;


drop trigger if exists round_countries_sync_entries_trg
on public.round_countries;

create trigger round_countries_sync_entries_trg
after insert or update or delete
on public.round_countries
for each row
execute function public.round_countries_sync_entries();


-- ------------------------------------------------------------
-- 3. SAFETY CHECK
-- ------------------------------------------------------------

do $$
declare
  missing_count integer;
begin

  select count(*)
  into missing_count
  from public.round_countries rc
  left join public.round_entries re
    on re.round_id = rc.round_id
   and re.entry_type = 'country'
   and re.country_code = rc.country_code
  where re.id is null;

  if missing_count > 0 then
    raise exception
      'round_entries synchronization failed: % country entries missing',
      missing_count;
  end if;
end;
$$;
