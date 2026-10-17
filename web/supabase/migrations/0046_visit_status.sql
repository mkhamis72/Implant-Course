-- Research readiness, part 2a: visit status per implant and the recall list, calculated here only (the app
-- renders it). Security invoker, so RLS applies; both need View on Patients (the status depends on follow-ups,
-- which Schedule-only users can't read, and the recall list shows phone numbers). They call only public
-- functions: authenticated has no usage on app_private.
create function public.implant_visits(p_patient uuid)
returns table (site_id uuid, tooth smallint, visit_key text, label text, target_date date, window_start date,
  window_end date, status text, followup_id uuid)
language sql stable security invoker set search_path = '' as $$
  select s.id, s.tooth::smallint, v.visit_key, v.label,
         s.placed_on + v.target_day, s.placed_on + v.window_start, s.placed_on + v.window_end,
         case
           when f.id is not null then
             case f.attendance when 'did_not_attend' then 'did_not_attend' when 'not_needed' then 'not_needed' else 'done' end
           when public.cairo_today() < s.placed_on + v.window_start then 'upcoming'
           when public.cairo_today() <= s.placed_on + v.target_day then 'due'
           when public.cairo_today() <= s.placed_on + v.window_end then 'overdue'
           else 'missed'
         end,
         f.id
  from public.implant_sites s
  cross join lateral public.visit_schedule(((public.cairo_today() - s.placed_on) + 60) / 365 + 1) v
  left join public.implant_followups f
    on f.site_id = s.id and f.visit_key = v.visit_key and f.voided_at is null
  where s.patient_id = p_patient
    and s.placed_on is not null
    and (select public.can('patients', 'view'))
    -- A failed (or removed) implant expects nothing more; what was recorded still shows.
    and (s.state in ('placed', 'restored') or f.id is not null)
  order by s.tooth, s.placed_on + v.target_day;
$$;

create function public.recall_list()
returns table (patient_id uuid, full_name text, phone text, site_id uuid, tooth smallint, visit_key text, label text,
  target_date date, window_end date, status text)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.full_name, p.phone, v.site_id, v.tooth, v.visit_key, v.label, v.target_date, v.window_end, v.status
  from public.patients p
  cross join lateral public.implant_visits(p.id) v
  where not p.archived
    and exists (select 1 from public.implant_sites s where s.patient_id = p.id and s.state in ('placed', 'restored'))
    and (v.status in ('due', 'overdue') or (v.status = 'missed' and v.window_end >= public.cairo_today() - 60))
  order by v.target_date, p.full_name, v.tooth;
$$;

revoke execute on function public.implant_visits(uuid) from public, anon;
grant execute on function public.implant_visits(uuid) to authenticated;
revoke execute on function public.recall_list() from public, anon;
grant execute on function public.recall_list() to authenticated;

-- "Last follow-up" in reports: a did-not-attend or not-needed visit has no outcome, so skip it rather than
-- showing a blank over the last real outcome. Latest definitions: 0035, 0030, 0027; only the subquery changes.

create or replace function public.course_report(p_course uuid)
returns table (
  site_id uuid, session_id uuid, session_title text, session_date date, slot_start timestamptz,
  patient_name text, file_no text, tooth smallint, state public.site_state, placed_on date,
  placing_delegate text, assisting_delegate text, supervisor text,
  brand text, system text, platform text, diameter_mm numeric, length_mm numeric, description text, lot_no text,
  torque_ncm numeric, isq numeric, bone_type text, technique text, graft text, last_outcome public.followup_outcome
)
language sql stable security invoker set search_path = '' as $$
  select s.id, se.id, se.title, se.date, o.starts_at,
         p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pd.full_name, ad.full_name, sv.full_name,
         pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description, l.lot_no,
         s.torque_ncm, s.isq, s.bone_type, s.technique, s.graft,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null and f.outcome is not null order by f.date desc, f.created_at desc limit 1)
  from public.courses c
  join public.implant_sites s on s.course_id = c.id
    or (s.course_id is null and s.placed_on between c.start_date and c.end_date
        and exists (select 1 from public.enrollments e where e.course_id = c.id and e.delegate_id = s.placing_delegate_id))
  join public.patients p on p.id = s.patient_id
  left join public.sessions se on se.id = s.session_id
  left join public.surgery_slots o on o.id = s.slot_id
  left join public.delegates pd on pd.id = s.placing_delegate_id
  left join public.delegates ad on ad.id = s.assisting_delegate_id
  left join public.supervisors sv on sv.id = s.supervisor_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where c.id = p_course and s.state not in ('planned', 'removed')
  order by se.date nulls last, o.starts_at nulls last, p.file_no, s.tooth;
$$;

create or replace function public.my_report()
returns table (
  site_id uuid, role text, course_name text, patient_name text, file_no text, tooth smallint,
  state public.site_state, placed_on date, brand text, system text, platform text, diameter_mm numeric,
  length_mm numeric, description text, lot_no text, last_outcome public.followup_outcome, technique text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := public.my_delegate_id();
begin
  if not public.is_delegate_user() then
    perform app_private.fail('This page is for delegate logins.');
  end if;
  return query
  select s.id, case when s.placing_delegate_id = v_me then 'placing' else 'assisting' end,
         c.name, p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description, l.lot_no,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null and f.outcome is not null order by f.date desc, f.created_at desc limit 1),
         s.technique
  from public.implant_sites s
  join public.patients p on p.id = s.patient_id
  left join public.courses c on c.id = s.course_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where (s.placing_delegate_id = v_me or s.assisting_delegate_id = v_me)
    and s.state not in ('planned', 'removed')
  order by c.start_date nulls last, s.placed_on, s.tooth;
end $$;

create or replace function public.delegate_report(p_delegate uuid)
returns table (
  site_id uuid, role text, course_id uuid, course_name text, patient_id uuid, patient_name text, file_no text,
  tooth smallint, state public.site_state, placed_on date, product_id uuid, type public.product_type,
  brand text, system text, platform text, diameter_mm numeric, length_mm numeric, description text,
  lot_no text, last_outcome public.followup_outcome, technique text
)
language sql stable security invoker set search_path = '' as $$
  select s.id,
         case when s.placing_delegate_id = p_delegate then 'placing' else 'assisting' end,
         c.id, c.name, p.id, p.full_name, p.file_no, s.tooth::smallint, s.state, s.placed_on,
         pr.id, pr.type, pr.brand, pr.system, pr.platform, pr.diameter_mm, pr.length_mm, pr.description,
         l.lot_no,
         (select f.outcome from public.implant_followups f
          where f.site_id = s.id and f.voided_at is null and f.outcome is not null
          order by f.date desc, f.created_at desc limit 1),
         s.technique
  from public.implant_sites s
  join public.patients p on p.id = s.patient_id
  left join public.courses c on c.id = s.course_id
  left join public.products pr on pr.id = s.product_id
  left join public.stock_lots l on l.id = s.stock_lot_id
  where (s.placing_delegate_id = p_delegate or s.assisting_delegate_id = p_delegate)
    and s.state not in ('planned', 'removed')
  order by c.start_date nulls last, s.placed_on, s.tooth;
$$;
