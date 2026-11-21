-- SMC Accounts - a third software mode, 'smc' (PFMS payments), next to
-- 'smc-e' and 'smc-e-old'.
--
-- Run this ONCE, after 0004_mode_profiles.sql:
-- Dashboard -> SQL Editor -> New query, paste the whole file, Run. Safe to run again.
--
-- What it does
-- ------------
--   profiles_app_mode_check   now also allows 'smc'
--
-- An SMC school is its own school, like an SMC E old one: 0004's unique index
-- is already per (owner, app_mode, dise_code), so one account can keep SMC E
-- and SMC books for the same DISE code without them ever being linked.

alter table public.profiles
  drop constraint if exists profiles_app_mode_check;
alter table public.profiles
  add constraint profiles_app_mode_check
  check (app_mode in ('smc-e', 'smc-e-old', 'smc'));
