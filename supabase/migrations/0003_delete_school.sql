-- SMC Accounts - letting an account delete one of its schools.
--
-- Run this ONCE, after 0001_smc_cloud.sql and 0002_account_approval.sql:
-- Dashboard -> SQL Editor -> New query, paste the whole file, Run. Safe to run again.
--
-- What it does
-- ------------
--   profiles.deleted_at     set when the account deletes the school
--   public.delete_profile() the only way to set it: the signed-in, approved
--                           owner, for one of their own schools
--
-- A deleted school disappears from the account: it is not listed, its key can
-- not be fetched (so no new PC can open it), and it takes no more backups. The
-- same DISE code can then be created again in the account.
--
-- What it does NOT do is destroy anything. The school's row, key and backup
-- files stay on the server, out of the account's reach. That keeps the promise
-- 0001 makes - a stolen password cannot wipe a school's history - because the
-- most a stolen login can do is hide a school, and the owner can undo that:
--
--   bring it back   Table Editor -> profiles -> clear deleted_at on the row
--   purge it        Table Editor -> profiles -> delete the row (its key and
--                   backup records go with it), then Storage -> backups ->
--                   delete the folder <user id>/<school id>/
--
-- (docs/SUPABASE_SETUP.md, "Deleted schools".)

alter table public.profiles add column if not exists deleted_at timestamptz;

-- One account cannot hold the same LIVE school twice; a deleted one does not
-- stand in the way of creating it again.
alter table public.profiles drop constraint if exists profiles_owner_id_dise_code_key;
create unique index if not exists profiles_owner_dise_live_idx
  on public.profiles (owner_id, dise_code)
  where deleted_at is null;

-- ------------------------------------------------------- hiding deleted ones

-- RESTRICTIVE, so they are ANDed with every rule in 0001 and 0002. The insert
-- rules for keys, backups and backup files look the school up in profiles
-- under these same rules, so a deleted school cannot take a key or a backup.
drop policy if exists "profiles: not deleted" on public.profiles;
create policy "profiles: not deleted" on public.profiles
  as restrictive for select to authenticated
  using (deleted_at is null);

drop policy if exists "keys: school not deleted" on public.profile_keys;
create policy "keys: school not deleted" on public.profile_keys
  as restrictive for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id));

drop policy if exists "backups: school not deleted" on public.backups;
create policy "backups: school not deleted" on public.backups
  as restrictive for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = profile_id))
  with check (exists (select 1 from public.profiles p where p.id = profile_id));

-- ------------------------------------------------------------- deleting one

-- SECURITY DEFINER because the app's role may not update profiles at all; the
-- function checks for itself what the policies would: signed in, approved, the
-- school is theirs and not already deleted. Returns whether a school was deleted.
create or replace function public.delete_profile(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if (select auth.uid()) is null or not public.is_approved() then
    return false;
  end if;

  update public.profiles
     set deleted_at = now()
   where id = p_id
     and owner_id = (select auth.uid())
     and deleted_at is null;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke execute on function public.delete_profile(uuid) from public, anon;
grant execute on function public.delete_profile(uuid) to authenticated;
