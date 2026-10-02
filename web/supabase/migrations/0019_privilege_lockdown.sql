-- Users only ever read and update their profile/settings rows; rows are created by
-- triggers and admin scripts. Remove the table-level write privileges Supabase grants by default.
revoke insert, delete, truncate on public.profiles, public.settings from authenticated;

-- New tables start locked: every table must grant what it needs explicitly.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
