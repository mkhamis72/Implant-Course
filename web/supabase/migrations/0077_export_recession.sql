-- Explore clinical data, part 1b: recession (0076) in the research export. Shipped one release after 0076 because
-- the previous build's assertAllowlisted refuses columns missing from its dictionary.
-- A new return column needs drop + create; latest definition: 0070_research_export.sql.

drop function public.research_export_visits(uuid, date, date, uuid, text, text);

create function public.research_export_visits(p_course uuid, p_from date, p_to date, p_delegate uuid,
  p_brand text, p_system text)
returns table (implant_code text, patient_code text, date date, visit_key text, attendance text, outcome text,
  pain_score int, swelling text, suppuration text, plaque text, mobility text, probing_mesial numeric,
  probing_buccal numeric, probing_distal numeric, probing_lingual numeric, bop_mesial text, bop_buccal text,
  bop_distal text, bop_lingual text, recession_facial_mm numeric, recession_mesial_mm numeric,
  recession_distal_mm numeric, isq numeric, prosthesis_status text, radiograph_taken text)
language sql security invoker set search_path = '' as $$
  select public.research_code('implant', o.site_id), public.research_code('patient', o.patient_id), f.date,
         f.visit_key, f.attendance, f.outcome::text, f.pain_score, f.swelling, f.suppuration, f.plaque, f.mobility,
         f.probing_mesial, f.probing_buccal, f.probing_distal, f.probing_lingual, f.bop_mesial, f.bop_buccal,
         f.bop_distal, f.bop_lingual, f.recession_facial_mm, f.recession_mesial_mm, f.recession_distal_mm, f.isq, f.prosthesis_status, f.radiograph_taken
  from public.implant_outcomes_detail(p_course, p_from, p_to, p_delegate, p_brand, p_system) o
  join public.implant_followups f on f.site_id = o.site_id and f.voided_at is null
  where (select public.can('research', 'view'))
  order by o.placed_on, o.patient_id, o.tooth, f.date, f.created_at;
$$;

revoke execute on function public.research_export_visits(uuid, date, date, uuid, text, text) from public, anon;
grant execute on function public.research_export_visits(uuid, date, date, uuid, text, text) to authenticated;
