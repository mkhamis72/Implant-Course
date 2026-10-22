-- Research part 5a: crown (restoration) survival, read only. One row per non-voided final restoration; temporaries
-- are not listed. The event is end_kind = 'remade' at ended_on. Otherwise the crown is censored at the latest contact
-- across its implants (same contacts as implant_outcomes: attended visits and measured, non-planning X-rays), or at
-- the first survival event among its implants (lost or removed, state removed, old failures without details), when
-- that comes first. Null parameters = no filter; the course is restorations.course_id, else the course_restorations
-- rule (fitted during the course by a delegate enrolled in it); from/to are on fitted_on. Additive: a new function.
create or replace function public.crown_outcomes(p_course uuid, p_from date, p_to date)
returns table (restoration_id uuid, patient_id uuid, type text, teeth smallint[], fitted_on date, last_contact date,
  follow_up_days int, remade boolean, remade_on date, censored_by_implant_event boolean, problems int, version text)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.patient_id, r.type, r.teeth, r.fitted_on,
         case when ev.remade then r.ended_on else lc.last_contact end,
         (case when ev.remade then r.ended_on else lc.last_contact end - r.fitted_on)::int,
         ev.remade,
         case when ev.remade then r.ended_on end,
         ev.censored,
         (select count(*) from public.restoration_problems rp
          where rp.restoration_id = r.id and rp.voided_at is null)::int,
         public.outcomes_version()
  from public.restorations r
  cross join lateral (
    -- The first implant event under the crown (null date = an event of unknown date) and the latest implant contact.
    select bool_or(x.is_event) as any_event,
           min(x.failed_on) filter (where x.is_event) as event_on,
           max(x.contact) as contact
    from (
      select s.failed_on,
             coalesce(s.failure_type in ('lost', 'removed') or s.state = 'removed'
                      or (s.state = 'failed' and s.failure_type is null), false) as is_event,
             greatest(
               (select max(f.date) from public.implant_followups f
                where f.site_id = s.id and f.voided_at is null and coalesce(f.attendance, 'attended') = 'attended'),
               (select max(xr.taken_on) from public.radiographs xr
                join public.radiograph_bone_levels l on l.radiograph_id = xr.id and l.site_id = s.id
                where xr.voided_at is null and xr.purpose <> 'planning' and xr.taken_on >= s.placed_on)
             ) as contact
      from public.restoration_sites rs
      join public.implant_sites s on s.id = rs.site_id
      where rs.restoration_id = r.id
    ) x
  ) im
  cross join lateral (
    select coalesce(r.end_kind = 'remade'
                    and not (im.any_event and im.event_on is not null and im.event_on < r.ended_on), false) as remade,
           coalesce(im.any_event
                    and not coalesce(r.end_kind = 'remade' and (im.event_on is null or r.ended_on <= im.event_on), false), false) as censored
  ) ev
  cross join lateral (
    -- At the first implant event when it has a date, else at the latest contact; never before the crown was fitted.
    select greatest(r.fitted_on, case when ev.censored and im.event_on is not null then im.event_on
                                      else im.contact end) as last_contact
  ) lc
  where r.stage = 'final' and r.voided_at is null
    and (select public.can('patients', 'view'))
    and (p_from is null or r.fitted_on >= p_from)
    and (p_to is null or r.fitted_on <= p_to)
    and (p_course is null
         or r.course_id = p_course
         or (r.course_id is null and exists (
               select 1 from public.courses c
               where c.id = p_course and r.fitted_on between c.start_date and c.end_date
                 and exists (select 1 from public.enrollments e
                             where e.course_id = c.id and e.delegate_id = r.delegate_id))))
  order by r.fitted_on, r.patient_id, r.teeth;
$$;
revoke execute on function public.crown_outcomes(uuid, date, date) from public, anon;
grant execute on function public.crown_outcomes(uuid, date, date) to authenticated;
