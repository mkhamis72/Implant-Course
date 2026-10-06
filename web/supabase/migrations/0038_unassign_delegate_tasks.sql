-- Checklist tasks go to staff only (0037). Clear assignments made to delegate logins before that.
update public.checklist_items i
set assignee_id = null
from public.profiles p
where p.user_id = i.assignee_id and p.role = 'delegate';
