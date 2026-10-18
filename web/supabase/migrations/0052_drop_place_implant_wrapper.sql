-- Course report cleanup (after 0035): the app places implants only through place_implant_v2.
drop function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text, uuid, text);
