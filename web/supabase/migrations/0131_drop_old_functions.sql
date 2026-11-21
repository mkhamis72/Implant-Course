-- Drop the previous versions of functions the app no longer calls. Each was kept for the app version before its
-- replacement shipped (0114-0126); every one of those releases has deployed, and no remaining function calls them.
-- App calls now: place_implant_v4, correct_placement_v3, create_surgery_slot_v4, update_surgery_slot_v3,
-- slot_conflicts_v2, create_pending_login_v2.

drop function public.place_implant_v3(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, text, text, uuid, text, uuid);
drop function public.correct_placement_v2(uuid, date, uuid, uuid, uuid, uuid, text, text);
drop function public.create_surgery_slot(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text);
drop function public.create_surgery_slot_v2(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text, uuid);
drop function public.create_surgery_slot_v3(uuid, uuid, time, time, uuid, uuid, uuid[], uuid[], jsonb, text, text, uuid, text, date);
drop function public.update_surgery_slot(uuid, uuid, time, time, uuid, uuid[], uuid[], text, text);
drop function public.update_surgery_slot_v2(uuid, uuid, time, time, uuid, uuid[], uuid[], text, text, uuid);
drop function public.slot_conflicts(uuid, uuid, time, time, uuid, uuid, uuid[], uuid);
drop function public.create_pending_login(text, text, public.user_role, uuid);
