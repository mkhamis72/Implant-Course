-- The app uses place_implant_v3 and correct_placement_v2 (0060); drop the previous placement functions.
drop function public.place_implant_v2(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid, text, numeric, text);
drop function public.correct_placement(uuid, date, uuid, uuid, uuid, numeric, numeric, text, text, text);
