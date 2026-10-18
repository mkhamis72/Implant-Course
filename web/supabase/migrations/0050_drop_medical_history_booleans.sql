-- Research readiness cleanup (after 0043): no app version writes the old boolean risk factors any more, so drop
-- them and medical_history_sync, which copied their writes across. The sync trigger also refused a future HbA1c
-- date (a check constraint can't use cairo_today()); that rule moves to its own trigger.
create function app_private.medical_history_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.hba1c_date is not null and new.hba1c_date > public.cairo_today() then
    perform app_private.fail('The HbA1c date can''t be in the future.');
  end if;
  return new;
end $$;

revoke execute on function app_private.medical_history_check() from public;

create trigger medical_history_check before insert or update on public.medical_history
  for each row execute function app_private.medical_history_check();

drop trigger medical_history_sync on public.medical_history;
drop function app_private.medical_history_sync();

alter table public.medical_history
  drop column diabetes,
  drop column smoker,
  drop column bisphosphonates,
  drop column anticoagulants,
  drop column radiotherapy_head_neck,
  drop column osteoporosis;
