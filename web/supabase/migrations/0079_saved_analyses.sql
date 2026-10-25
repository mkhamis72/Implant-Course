-- Explore clinical data, part 5: saved analyses (shared with everyone who has Statistics view; the creator or an
-- admin changes them) and the study codes behind the Explore data export.

-- config = { "version": 1, "query": { <Explore URL parameter>: <string> } }; the TS checks the keys (saved.ts).
create table public.saved_analyses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 120 and title = trim(title)),
  config jsonb not null check (jsonb_typeof(config) = 'object' and coalesce(config ->> 'version' = '1', false)
    and coalesce(jsonb_typeof(config -> 'query') = 'object', false) and pg_column_size(config) < 16384),
  -- Context only: deleting the course keeps the analysis.
  course_id uuid references public.courses (id) on delete set null,
  created_by uuid not null references public.profiles (user_id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now()
);
create index saved_analyses_created_idx on public.saved_analyses (created_at desc);

create trigger saved_analyses_set_updated_at before update on public.saved_analyses
  for each row execute function app_private.set_updated_at();
create trigger saved_analyses_audit after insert or update or delete on public.saved_analyses
  for each row execute function app_private.audit_row('id');

revoke all on public.saved_analyses from public, anon, authenticated;
grant select on public.saved_analyses to authenticated;
alter table public.saved_analyses enable row level security;
create policy saved_analyses_select on public.saved_analyses for select to authenticated
  using (public.is_active_user());
create policy saved_analyses_area_read on public.saved_analyses as restrictive for select to authenticated
  using ((select public.can('research', 'view')) and (select public.can('patients', 'view')));

-- Adds (p_id null) or changes a saved analysis. Changing needs the creator or an admin; last write wins.
create function public.save_analysis(p_id uuid, p_title text, p_config jsonb, p_course uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_owner uuid;
  v_id uuid;
begin
  perform app_private.require_perm('research', 'edit');
  if not public.can('patients', 'view') then
    perform app_private.fail('Saving an analysis needs View on Patients.');
  end if;
  if length(v_title) not between 1 and 120 then
    perform app_private.fail('Enter a title for the analysis.');
  end if;
  if p_id is null then
    insert into public.saved_analyses (title, config, course_id, created_by)
    values (v_title, p_config, p_course, auth.uid())
    returning id into v_id;
    return v_id;
  end if;
  select created_by into v_owner from public.saved_analyses where id = p_id for update;
  if not found then
    perform app_private.fail('Saved analysis not found.');
  end if;
  if v_owner is distinct from auth.uid() and not public.is_admin() then
    perform app_private.fail('Only the person who saved this analysis or an admin can change it.');
  end if;
  update public.saved_analyses set title = v_title, config = p_config, course_id = p_course where id = p_id;
  return p_id;
end $$;

create function public.delete_analysis(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
begin
  perform app_private.require_perm('research', 'edit');
  select created_by into v_owner from public.saved_analyses where id = p_id for update;
  if not found then
    perform app_private.fail('Saved analysis not found.');
  end if;
  if v_owner is distinct from auth.uid() and not public.is_admin() then
    perform app_private.fail('Only the person who saved this analysis or an admin can change it.');
  end if;
  delete from public.saved_analyses where id = p_id;
end $$;

-- The study codes of the analysed implants, their patients, placing delegates, supervisors and courses, read only
-- (the Explore export calls assign_research_codes first, so no code is created here). Empty = not assigned / none.
create function public.analysis_codes(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (site_id uuid, implant_code text, patient_code text, delegate_code text, supervisor_code text,
  course_code text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_perm('research', 'view');
  if not public.can('patients', 'view') then
    perform app_private.fail('Research export needs View on Patients');
  end if;
  return query
    select o.site_id, ci.code, cp.code, cd.code, cs.code, cc.code
    from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
    join public.implant_sites s on s.id = o.site_id
    left join app_private.research_codes ci on ci.entity = 'implant' and ci.entity_id = o.site_id
    left join app_private.research_codes cp on cp.entity = 'patient' and cp.entity_id = o.patient_id
    left join app_private.research_codes cd on cd.entity = 'delegate' and cd.entity_id = s.placing_delegate_id
    left join app_private.research_codes cs on cs.entity = 'supervisor' and cs.entity_id = s.supervisor_id
    left join app_private.research_codes cc on cc.entity = 'course' and cc.entity_id = o.course_id
    order by o.site_id;
end $$;

revoke execute on function public.save_analysis(uuid, text, jsonb, uuid), public.delete_analysis(uuid),
  public.analysis_codes(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.save_analysis(uuid, text, jsonb, uuid), public.delete_analysis(uuid),
  public.analysis_codes(uuid, date, date, uuid, text, text) to authenticated;
