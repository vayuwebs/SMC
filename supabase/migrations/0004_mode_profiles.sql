-- SMC Accounts - separate cloud schools per mode ('smc-e' vs 'smc-e-old').
--
-- Run this ONCE, after 0003_delete_school.sql:
-- Dashboard -> SQL Editor -> New query, paste the whole file, Run. Safe to run again.
--
-- What it does
-- ------------
--   profiles.app_mode                 which mode created/owns the school ('smc-e' or 'smc-e-old')
--   profiles_owner_mode_dise_live_idx scopes uniqueness to (owner_id, app_mode, dise_code)
--                                     so one account can maintain separate SMC E and SMC E old
--                                     books even for the same DISE code
--   public.create_profile_for_mode()  creates a school + key with an explicit app_mode

alter table public.profiles
  add column if not exists app_mode text not null default 'smc-e';

alter table public.profiles
  drop constraint if exists profiles_app_mode_check;
alter table public.profiles
  add constraint profiles_app_mode_check
  -- 'smc' too (0005), so running this file again never takes it away.
  check (app_mode in ('smc-e', 'smc-e-old', 'smc'));

drop index if exists public.profiles_owner_dise_live_idx;
create unique index if not exists profiles_owner_mode_dise_live_idx
  on public.profiles (owner_id, app_mode, dise_code)
  where deleted_at is null;

create or replace function public.create_profile_for_mode(
  p_id uuid,
  p_school_name_gu text,
  p_dise_code text,
  p_key_hex text,
  p_app_mode text
)
returns public.profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created public.profiles;
begin
  insert into public.profiles (id, owner_id, school_name_gu, dise_code, app_mode)
  values (p_id, auth.uid(), p_school_name_gu, p_dise_code, coalesce(p_app_mode, 'smc-e'))
  returning * into created;

  insert into public.profile_keys (profile_id, owner_id, key_hex)
  values (p_id, auth.uid(), p_key_hex);

  return created;
end;
$$;

revoke execute on function public.create_profile_for_mode(uuid, text, text, text, text) from public, anon;
grant execute on function public.create_profile_for_mode(uuid, text, text, text, text) to authenticated;
