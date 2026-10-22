-- Course choices for the placement, correction and restoration forms. The courses table is readable only with
-- Courses or Schedule view; anyone who may view patients needs the list to record where an implant was placed.
create function public.course_options()
returns table (id uuid, name text, start_date date, end_date date)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'view');
  return query
  select c.id, c.name, c.start_date, c.end_date from public.courses c
  order by c.start_date desc, c.id;
end $$;

revoke execute on function public.course_options() from public, anon;
grant execute on function public.course_options() to authenticated;
