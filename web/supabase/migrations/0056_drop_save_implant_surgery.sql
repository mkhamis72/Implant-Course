-- Surgical details cleanup (after 0053): the app saves surgical details only through save_implant_surgery_v2.
drop function public.save_implant_surgery(uuid, date, text, text, numeric, text, text, text, text, text, timestamptz);
