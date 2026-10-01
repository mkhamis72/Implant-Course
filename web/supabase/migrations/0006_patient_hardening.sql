-- Final review of Plan 2 (I1, I2): users may only write the columns the app writes.
-- Who/when columns (created_by, created_at, author_id, ids, updated_at) are set by the database.

revoke insert, update on public.patients from authenticated;
grant insert (file_no, full_name, dob, sex, phone, email, address, archived) on public.patients to authenticated;
grant update (file_no, full_name, dob, sex, phone, email, address, archived) on public.patients to authenticated;

revoke update on public.medical_history from authenticated;
grant update (allergies, medications, diabetes, smoker, bisphosphonates, anticoagulants,
              radiotherapy_head_neck, osteoporosis, other_conditions, notes)
  on public.medical_history to authenticated;

revoke insert on public.visit_notes from authenticated;
grant insert (patient_id, visit_date, text, teeth) on public.visit_notes to authenticated;
-- +1 day so "today" in Cairo (up to UTC+3) is always accepted.
alter table public.visit_notes add constraint visit_notes_visit_date_check check (visit_date <= current_date + 1);

-- tooth_status: PostgREST upserts set patient_id and tooth to the same values, so they stay
-- writable, but a trigger refuses any actual change of patient or tooth.
revoke insert, update on public.tooth_status from authenticated;
grant insert (patient_id, tooth, status) on public.tooth_status to authenticated;
grant update (patient_id, tooth, status) on public.tooth_status to authenticated;

create function app_private.freeze_tooth_identity() returns trigger
language plpgsql as $$
begin
  if new.patient_id <> old.patient_id or new.tooth <> old.tooth then
    raise exception 'A tooth status record cannot change patient or tooth (cannot change)';
  end if;
  return new;
end $$;

create trigger tooth_status_freeze_identity before update on public.tooth_status
  for each row execute function app_private.freeze_tooth_identity();

-- File numbers: case-insensitive uniqueness, and automatic numbers skip any number already
-- typed by hand (e.g. a migrated paper file "P00042").
create unique index patients_file_no_upper_key on public.patients (upper(file_no));

create function public.next_file_no() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  n bigint;
  candidate text;
begin
  loop
    n := nextval('public.patients_file_no_seq');
    candidate := 'P' || lpad(n::text, greatest(5, length(n::text)), '0');
    exit when not exists (select 1 from public.patients p where upper(p.file_no) = candidate);
  end loop;
  return candidate;
end $$;

revoke execute on function public.next_file_no() from public, anon;
grant execute on function public.next_file_no() to authenticated;
alter table public.patients alter column file_no set default public.next_file_no();
