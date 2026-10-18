-- Follow-up visits cleanup (after 0045): the app records visits only through record_visit.
drop function public.record_followup(uuid, date, text, public.followup_outcome, text);
