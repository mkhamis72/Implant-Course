create domain public.fdi_tooth as smallint
  check (value between 11 and 18 or value between 21 and 28 or value between 31 and 38 or value between 41 and 48);

create type public.tooth_state as enum (
  'present', 'missing', 'extracted', 'implant_planned', 'implant_placed', 'restored', 'failed'
);

create sequence public.patients_file_no_seq;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  file_no text not null unique
    default ('P' || lpad(nextval('public.patients_file_no_seq')::text, 5, '0'))
    check (length(trim(file_no)) between 1 and 30),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  dob date check (dob >= '1900-01-01'),
  sex text check (sex in ('female', 'male')),
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.medical_history (
  patient_id uuid primary key references public.patients (id) on delete cascade,
  allergies text not null default '',
  medications text not null default '',
  diabetes boolean not null default false,
  smoker boolean not null default false,
  bisphosphonates boolean not null default false,
  anticoagulants boolean not null default false,
  radiotherapy_head_neck boolean not null default false,
  osteoporosis boolean not null default false,
  other_conditions text not null default '',
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create table public.visit_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  visit_date date not null default current_date,
  author_id uuid not null default auth.uid() references public.profiles (user_id),
  text text not null check (length(trim(text)) between 1 and 5000),
  teeth public.fdi_tooth[] not null default '{}',
  created_at timestamptz not null default now()
);
create index visit_notes_patient_idx on public.visit_notes (patient_id, visit_date desc, created_at desc);

create table public.tooth_status (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  tooth public.fdi_tooth not null,
  status public.tooth_state not null,
  updated_at timestamptz not null default now(),
  unique (patient_id, tooth)
);

create trigger patients_set_updated_at before update on public.patients
  for each row execute function app_private.set_updated_at();
create trigger medical_history_set_updated_at before update on public.medical_history
  for each row execute function app_private.set_updated_at();
create trigger tooth_status_set_updated_at before update on public.tooth_status
  for each row execute function app_private.set_updated_at();

-- Every patient has exactly one medical_history row.
create function app_private.create_medical_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.medical_history (patient_id) values (new.id);
  return new;
end $$;

create trigger patients_create_medical_history after insert on public.patients
  for each row execute function app_private.create_medical_history();

-- Privileges: no anon access; no deletes (patients are archived); notes are append-only.
revoke all on public.patients, public.medical_history, public.visit_notes, public.tooth_status from anon;
revoke delete, truncate on public.patients, public.medical_history, public.visit_notes, public.tooth_status
  from authenticated;
revoke insert on public.medical_history from authenticated;
revoke update on public.visit_notes from authenticated;
grant usage on sequence public.patients_file_no_seq to authenticated;

alter table public.patients enable row level security;
alter table public.medical_history enable row level security;
alter table public.visit_notes enable row level security;
alter table public.tooth_status enable row level security;

create policy patients_select on public.patients for select to authenticated using (public.is_active_user());
create policy patients_insert on public.patients for insert to authenticated with check (public.is_active_user());
create policy patients_update on public.patients for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

create policy medical_history_select on public.medical_history for select to authenticated
  using (public.is_active_user());
create policy medical_history_update on public.medical_history for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

create policy visit_notes_select on public.visit_notes for select to authenticated using (public.is_active_user());
create policy visit_notes_insert on public.visit_notes for insert to authenticated
  with check (public.is_active_user() and author_id = auth.uid());

-- Users may only set and change the manual states; implant states belong to later workflows.
create policy tooth_status_select on public.tooth_status for select to authenticated using (public.is_active_user());
create policy tooth_status_insert on public.tooth_status for insert to authenticated
  with check (public.is_active_user() and status in ('present', 'missing', 'extracted'));
create policy tooth_status_update on public.tooth_status for update to authenticated
  using (public.is_active_user() and status in ('present', 'missing', 'extracted'))
  with check (public.is_active_user() and status in ('present', 'missing', 'extracted'));

create trigger patients_audit after insert or update or delete on public.patients
  for each row execute function app_private.audit_row('id');
create trigger medical_history_audit after insert or update or delete on public.medical_history
  for each row execute function app_private.audit_row('patient_id');
create trigger visit_notes_audit after insert or update or delete on public.visit_notes
  for each row execute function app_private.audit_row('id');
create trigger tooth_status_audit after insert or update or delete on public.tooth_status
  for each row execute function app_private.audit_row('id');

create index audit_log_patient_idx on public.audit_log
  ((coalesce(after ->> 'patient_id', before ->> 'patient_id')));
