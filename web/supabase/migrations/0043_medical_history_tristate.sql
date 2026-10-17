-- Research readiness, part 1: risk factors are yes / no / not assessed (null). The old booleans defaulted to
-- false, so "never asked" looked like "no": true becomes yes (smoker: current), false becomes not assessed.
-- The booleans stay for the release window (the previous app version still writes them); a trigger copies
-- those writes across. A later migration drops the booleans and the trigger.
alter table public.medical_history
  add column smoking text check (smoking in ('never', 'former', 'current')),
  add column cigarettes_per_day int check (cigarettes_per_day between 1 and 100),
  add column diabetes_status text check (diabetes_status in ('yes', 'no')),
  add column hba1c numeric(3, 1) check (hba1c between 4 and 20),
  add column hba1c_date date,
  add column bisphosphonates_status text check (bisphosphonates_status in ('yes', 'no')),
  add column anticoagulants_status text check (anticoagulants_status in ('yes', 'no')),
  add column radiotherapy_status text check (radiotherapy_status in ('yes', 'no')),
  add column osteoporosis_status text check (osteoporosis_status in ('yes', 'no')),
  add column periodontitis_history text check (periodontitis_history in ('yes', 'no')),
  add column bruxism text check (bruxism in ('yes', 'no')),
  add column previous_implant_failure text check (previous_implant_failure in ('yes', 'no')),
  add constraint medical_history_cigarettes_need_current check (cigarettes_per_day is null or smoking = 'current'),
  add constraint medical_history_hba1c_with_date check ((hba1c is null) = (hba1c_date is null));

update public.medical_history set
  smoking = case when smoker then 'current' end,
  diabetes_status = case when diabetes then 'yes' end,
  bisphosphonates_status = case when bisphosphonates then 'yes' end,
  anticoagulants_status = case when anticoagulants then 'yes' end,
  radiotherapy_status = case when radiotherapy_head_neck then 'yes' end,
  osteoporosis_status = case when osteoporosis then 'yes' end
where smoker or diabetes or bisphosphonates or anticoagulants or radiotherapy_head_neck or osteoporosis;

-- Release window: the previous version writes the booleans. On insert only a true counts (and a value already
-- present wins, so restoring a dump keeps the tri-state answers); on update only a changed boolean counts.
-- Also refuses a future HbA1c date (a check constraint can't use cairo_today()).
create function app_private.medical_history_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.hba1c_date is not null and new.hba1c_date > public.cairo_today() then
    perform app_private.fail('The HbA1c date can''t be in the future.');
  end if;
  if tg_op = 'INSERT' then
    if new.smoker then new.smoking := coalesce(new.smoking, 'current'); end if;
    if new.diabetes then new.diabetes_status := coalesce(new.diabetes_status, 'yes'); end if;
    if new.bisphosphonates then new.bisphosphonates_status := coalesce(new.bisphosphonates_status, 'yes'); end if;
    if new.anticoagulants then new.anticoagulants_status := coalesce(new.anticoagulants_status, 'yes'); end if;
    if new.radiotherapy_head_neck then new.radiotherapy_status := coalesce(new.radiotherapy_status, 'yes'); end if;
    if new.osteoporosis then new.osteoporosis_status := coalesce(new.osteoporosis_status, 'yes'); end if;
    return new;
  end if;
  if new.smoker is distinct from old.smoker then
    new.smoking := case when new.smoker then 'current' else 'never' end;
    if not new.smoker then new.cigarettes_per_day := null; end if;
  end if;
  if new.diabetes is distinct from old.diabetes then
    new.diabetes_status := case when new.diabetes then 'yes' else 'no' end;
  end if;
  if new.bisphosphonates is distinct from old.bisphosphonates then
    new.bisphosphonates_status := case when new.bisphosphonates then 'yes' else 'no' end;
  end if;
  if new.anticoagulants is distinct from old.anticoagulants then
    new.anticoagulants_status := case when new.anticoagulants then 'yes' else 'no' end;
  end if;
  if new.radiotherapy_head_neck is distinct from old.radiotherapy_head_neck then
    new.radiotherapy_status := case when new.radiotherapy_head_neck then 'yes' else 'no' end;
  end if;
  if new.osteoporosis is distinct from old.osteoporosis then
    new.osteoporosis_status := case when new.osteoporosis then 'yes' else 'no' end;
  end if;
  return new;
end $$;

revoke execute on function app_private.medical_history_sync() from public;

create trigger medical_history_sync before insert or update on public.medical_history
  for each row execute function app_private.medical_history_sync();

grant update (smoking, cigarettes_per_day, diabetes_status, hba1c, hba1c_date, bisphosphonates_status, anticoagulants_status,
  radiotherapy_status, osteoporosis_status, periodontitis_history, bruxism, previous_implant_failure)
  on public.medical_history to authenticated;
