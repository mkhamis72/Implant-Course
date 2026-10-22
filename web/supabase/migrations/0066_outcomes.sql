-- Research part 5a: implant outcomes, read only. Survival (still in the mouth) at loading and at 1, 2, 3 and 5 years
-- with censoring at the last contact, and the ICOI 2008 (Misch) health scale per attended visit. Nothing is stored:
-- every reader returns the rule version, and a later rule change becomes a new version (outcomes_version).
-- Readers are security invoker and need View on Patients, like implant_visits / recall_list. Additive: new
-- functions only.

create or replace function public.outcomes_version() returns text
language sql immutable set search_path = '' as $$
  select 'outcomes-v1'::text;
$$;
revoke execute on function public.outcomes_version() from public, anon;
grant execute on function public.outcomes_version() to authenticated;

-- The ICOI cut-offs live only here. Missing pain, mobility, suppuration or bone loss gives not_assessable, never a
-- better grade; a failed or removed implant is IV regardless. Pain 1-3 is "sensitivity" (III), 4 or more is pain on
-- function (IV). Bone loss < 2 mm I, 2-4 mm II, > 4 mm III, more than half the implant length IV (with an unknown
-- length, bone loss over 4 mm is not_assessable: IV can't be ruled out). Probing is optional: any recorded depth > 7 mm gives III. The worst grade wins.
create or replace function public.icoi_grade(p_failed boolean, p_pain int, p_mobility text, p_suppuration text,
  p_bone_loss_mm numeric, p_implant_length_mm numeric, p_max_probing_mm numeric) returns text
language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_failed, false) then 'IV'
    when p_pain is null or p_mobility is null or p_suppuration is null or p_bone_loss_mm is null then 'not_assessable'
    when p_pain >= 4 or p_mobility = 'yes' then 'IV'
    when p_implant_length_mm is not null and p_bone_loss_mm > p_implant_length_mm / 2 then 'IV'
    when p_implant_length_mm is null and p_bone_loss_mm > 4 then 'not_assessable'
    when p_pain >= 1 or p_suppuration = 'yes' or p_bone_loss_mm > 4 or p_max_probing_mm > 7 then 'III'
    when p_bone_loss_mm >= 2 then 'II'
    else 'I'
  end;
$$;
revoke execute on function public.icoi_grade(boolean, int, text, text, numeric, numeric, numeric) from public, anon;
grant execute on function public.icoi_grade(boolean, int, text, text, numeric, numeric, numeric) to authenticated;

-- Survival at one milestone (days from placement: the visit window start and target of visit_schedule). An event
-- with an unknown date is unknown; an event on or before the target day is failed; a contact on or after the
-- window start is survived; otherwise unknown (never surviving past the last contact).
create or replace function public.survival_at(p_placed_on date, p_event boolean, p_event_on date, p_last_contact date,
  p_window_start int, p_target_day int) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_event and p_event_on is null then 'unknown'
    when p_event and p_event_on <= p_placed_on + p_target_day then 'failed'
    when p_last_contact >= p_placed_on + p_window_start then 'survived'
    else 'unknown'
  end;
$$;
revoke execute on function public.survival_at(date, boolean, date, date, int, int) from public, anon;
grant execute on function public.survival_at(date, boolean, date, date, int, int) to authenticated;

-- One row per attended visit (old visits without attendance count as attended) of the placed implants of the given
-- patients (null = every patient). Bone loss = the worse of mesial/distal of (follow-up - baseline), for sides
-- measured on both: baseline = the earliest measured X-ray on or after placement with purpose baseline, else the
-- earliest measured one; follow-up = the latest measured X-ray dated after the baseline and on or before the visit.
-- Planning X-rays never count (here or as a contact).
-- A visit is failed (IV) when it recorded the failure or is on or after the failure date.
create or replace function public.visit_grades(p_patients uuid[])
returns table (site_id uuid, visit_id uuid, visit_date date, bone_loss_mm numeric, grade text, reason text)
language sql stable security invoker set search_path = '' as $$
  select s.id, f.id, f.date, m.bone_loss, g.grade,
         case
           when m.failed then
             case s.failure_type when 'failed_in_place' then 'failed in place' when 'lost' then 'implant lost'
               when 'removed' then 'implant removed' else 'implant failed' end
           when g.grade = 'not_assessable' then
             case
               when b.taken_on is null then 'no baseline X-ray'
               when x.taken_on is null then 'no follow-up X-ray'
               when m.bone_loss is null then 'no comparable bone level'
               when f.pain_score is null then 'pain not recorded'
               when f.mobility is null then 'mobility not recorded'
               when f.suppuration is null then 'suppuration not recorded'
               else 'implant length unknown'
             end
           -- The criterion that alone gives the grade (cut-offs stay in icoi_grade).
           when public.icoi_grade(false, 0, 'no', 'no', m.bone_loss, pr.length_mm, null) = g.grade
             then 'bone loss ' || trim_scale(m.bone_loss)::text || ' mm'
           when public.icoi_grade(false, 0, f.mobility, 'no', 0, pr.length_mm, null) = g.grade then 'mobility'
           when public.icoi_grade(false, f.pain_score, 'no', 'no', 0, pr.length_mm, null) = g.grade
             then 'pain ' || f.pain_score::text
           when public.icoi_grade(false, 0, 'no', f.suppuration, 0, pr.length_mm, null) = g.grade then 'suppuration'
           else 'probing ' || trim_scale(m.probing)::text || ' mm'
         end
  from public.implant_sites s
  join public.implant_followups f
    on f.site_id = s.id and f.voided_at is null and coalesce(f.attendance, 'attended') = 'attended'
  left join public.products pr on pr.id = s.product_id
  left join lateral (
    select r.taken_on, l.mesial_mm, l.distal_mm
    from public.radiographs r
    join public.radiograph_bone_levels l on l.radiograph_id = r.id and l.site_id = s.id
    where r.voided_at is null and r.purpose <> 'planning' and r.taken_on >= s.placed_on
    order by (r.purpose = 'baseline') desc, r.taken_on, r.created_at
    limit 1
  ) b on true
  left join lateral (
    select r.taken_on, l.mesial_mm, l.distal_mm
    from public.radiographs r
    join public.radiograph_bone_levels l on l.radiograph_id = r.id and l.site_id = s.id
    where r.voided_at is null and r.purpose <> 'planning' and r.taken_on > b.taken_on and r.taken_on <= f.date
    order by r.taken_on desc, r.created_at desc
    limit 1
  ) x on true
  cross join lateral (
    select
      f.outcome = 'failed'
        or (s.state in ('failed', 'removed')
            and f.date >= coalesce(s.failed_on,
                  (select min(f2.date) from public.implant_followups f2
                   where f2.site_id = s.id and f2.voided_at is null and f2.outcome = 'failed'))) as failed,
      greatest(x.mesial_mm - b.mesial_mm, x.distal_mm - b.distal_mm) as bone_loss,
      greatest(f.probing_mesial, f.probing_buccal, f.probing_distal, f.probing_lingual) as probing
  ) m
  cross join lateral (
    select public.icoi_grade(coalesce(m.failed, false), f.pain_score, f.mobility, f.suppuration, m.bone_loss,
      pr.length_mm, m.probing) as grade
  ) g
  where s.placed_on is not null
    and (p_patients is null or s.patient_id = any (p_patients))
    and (select public.can('patients', 'view'))
  order by s.patient_id, s.tooth, f.date, f.created_at;
$$;
revoke execute on function public.visit_grades(uuid[]) from public, anon;
grant execute on function public.visit_grades(uuid[]) to authenticated;

-- One row per placed implant. Null parameters = no filter; the course is implant_sites.course_id, else (as in
-- course_report) placed during the course by a delegate enrolled in it; from/to are on placed_on.
-- Survival events: failure_type lost or removed, state removed, and old failures without details (type unknown).
-- failed_in_place survives (and is graded IV). Last contact = the latest attended visit, measured X-ray of the
-- implant or event date. follow_up_days is the curve time: to the event date for an event, else to the last
-- contact (0 when never seen); an event without a date (event_time_unknown) belongs out of the curve.
-- Loading = the earliest non-voided restoration (temporary or final). At loading: an event and no loading date is
-- failed (early failure); with a loading date, an event on or before it is failed, after it survived; no event and
-- no restoration is not_loaded. Latest grade = the most recent assessable
-- grade (a failed implant is IV from its failure date); ungraded_later counts not-assessable visits after it.
create or replace function public.implant_outcomes(p_course uuid, p_from date, p_to date)
returns table (site_id uuid, patient_id uuid, tooth smallint, course_id uuid, placed_on date, loaded_on date,
  last_contact date, follow_up_days int, event boolean, event_on date, event_time_unknown boolean, at_loading text,
  year_1 text, year_2 text, year_3 text, year_5 text, latest_grade text, latest_grade_on date, ungraded_later int,
  biological_complications int, mechanical_complications int, version text)
language sql stable security invoker set search_path = '' as $$
  with sel as (
    select s.*,
           coalesce(s.failure_type in ('lost', 'removed') or s.state = 'removed'
                    or (s.state = 'failed' and s.failure_type is null), false) as is_event
    from public.implant_sites s
    where s.placed_on is not null
      and (select public.can('patients', 'view'))
      and (p_from is null or s.placed_on >= p_from)
      and (p_to is null or s.placed_on <= p_to)
      and (p_course is null
           or s.course_id = p_course
           or (s.course_id is null and exists (
                 select 1 from public.courses c
                 where c.id = p_course and s.placed_on between c.start_date and c.end_date
                   and exists (select 1 from public.enrollments e
                               where e.course_id = c.id and e.delegate_id = s.placing_delegate_id))))
  ),
  g as (
    select * from public.visit_grades(coalesce((select array_agg(distinct sel.patient_id) from sel), '{}'::uuid[]))
  ),
  w as (
    select max(v.window_start) filter (where v.visit_key = 'month_12') as y1_start,
           max(v.target_day) filter (where v.visit_key = 'month_12') as y1_target,
           max(v.window_start) filter (where v.visit_key = 'year_2') as y2_start,
           max(v.target_day) filter (where v.visit_key = 'year_2') as y2_target,
           max(v.window_start) filter (where v.visit_key = 'year_3') as y3_start,
           max(v.target_day) filter (where v.visit_key = 'year_3') as y3_target,
           max(v.window_start) filter (where v.visit_key = 'year_5') as y5_start,
           max(v.target_day) filter (where v.visit_key = 'year_5') as y5_target
    from public.visit_schedule(5) v
  )
  select s.id, s.patient_id, s.tooth::smallint, coalesce(s.course_id, p_course), s.placed_on, ld.loaded_on,
         lc.last_contact,
         (coalesce(case when s.is_event then s.failed_on end, lc.last_contact, s.placed_on) - s.placed_on)::int,
         s.is_event,
         case when s.is_event then s.failed_on end,
         s.is_event and s.failed_on is null,
         case
           -- Lost before it was ever loaded: an early failure.
           when s.is_event and ld.loaded_on is null then 'failed'
           when s.is_event and s.failed_on is null then 'unknown'
           when ld.loaded_on is null then 'not_loaded'
           when s.is_event and s.failed_on <= ld.loaded_on then 'failed'
           else 'survived'
         end,
         public.survival_at(s.placed_on, s.is_event, s.failed_on, lc.last_contact, w.y1_start, w.y1_target),
         public.survival_at(s.placed_on, s.is_event, s.failed_on, lc.last_contact, w.y2_start, w.y2_target),
         public.survival_at(s.placed_on, s.is_event, s.failed_on, lc.last_contact, w.y3_start, w.y3_target),
         public.survival_at(s.placed_on, s.is_event, s.failed_on, lc.last_contact, w.y5_start, w.y5_target),
         case when s.state in ('failed', 'removed') then 'IV' else lg.grade end,
         lg.on_date,
         (select count(*) from g where g.site_id = s.id and g.grade = 'not_assessable'
            and (lg.on_date is null or g.visit_date > lg.on_date))::int,
         (select count(*) from public.implant_complications k
          where k.site_id = s.id and k.voided_at is null and k.category = 'biological')::int,
         (select count(*) from public.implant_complications k
          where k.site_id = s.id and k.voided_at is null and k.category = 'mechanical')::int,
         public.outcomes_version()
  from sel s
  cross join w
  cross join lateral (
    select min(r.fitted_on) as loaded_on
    from public.restorations r
    join public.restoration_sites rs on rs.restoration_id = r.id and rs.site_id = s.id
    where r.voided_at is null
  ) ld
  cross join lateral (
    select greatest(
      (select max(f.date) from public.implant_followups f
       where f.site_id = s.id and f.voided_at is null and coalesce(f.attendance, 'attended') = 'attended'),
      (select max(r.taken_on) from public.radiographs r
       join public.radiograph_bone_levels l on l.radiograph_id = r.id and l.site_id = s.id
       where r.voided_at is null and r.purpose <> 'planning' and r.taken_on >= s.placed_on),
      case when s.is_event then s.failed_on end
    ) as last_contact
  ) lc
  left join lateral (
    select c.grade, c.on_date
    from (
      select g.grade, g.visit_date as on_date from g where g.site_id = s.id and g.grade <> 'not_assessable'
      union all
      select 'IV', s.failed_on where s.state in ('failed', 'removed') and s.failed_on is not null
    ) c
    order by c.on_date desc, (c.grade = 'IV') desc
    limit 1
  ) lg on true
  order by s.placed_on, s.patient_id, s.tooth;
$$;
revoke execute on function public.implant_outcomes(uuid, date, date) from public, anon;
grant execute on function public.implant_outcomes(uuid, date, date) to authenticated;
