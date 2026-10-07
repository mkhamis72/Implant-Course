-- Add surgery day: Schedule editors add a surgery session from the Schedule page. Inserting into
-- sessions directly needs Edit on Courses; this function needs Edit on Schedule and only ever
-- creates surgery sessions. The course-date check, checklist templates and audit run as usual.
create function public.add_surgery_session(
  p_course uuid, p_date date, p_title text, p_start time, p_end time, p_room text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform app_private.require_perm('schedule', 'edit');
  if not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Course not found.');
  end if;
  if length(trim(coalesce(p_title, ''))) not between 2 and 120 then
    perform app_private.fail('Enter the session title.');
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    perform app_private.fail('The session must end after it starts.');
  end if;
  insert into public.sessions (course_id, type, title, date, start_time, end_time, room)
  values (p_course, 'surgery', trim(p_title), p_date, p_start, p_end, nullif(trim(coalesce(p_room, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.add_surgery_session(uuid, date, text, time, time, text) from public, anon;
grant execute on function public.add_surgery_session(uuid, date, text, time, time, text) to authenticated;
