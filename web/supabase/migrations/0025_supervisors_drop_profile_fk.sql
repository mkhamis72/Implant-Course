-- Release 2 of the supervisors list: supervisor ids no longer have to be user accounts.
-- The app reads names through *_supervisor_ref_fkey since release 1 (0024).
alter table public.surgery_slots drop constraint surgery_slots_supervisor_id_fkey;
alter table public.implant_sites drop constraint implant_sites_supervisor_id_fkey;
