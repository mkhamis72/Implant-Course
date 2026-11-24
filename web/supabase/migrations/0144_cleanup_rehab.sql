-- Clean-up after the rehabilitation projects (plan 2026-11-24-cleanup-rehab):
-- * The planned-product key comes back: implant_sites (company_id, planned_product_id) -> products (company_id, id),
--   dropped by 0141 for the implant-types release. Every PostgREST embed of products from implant_sites in the
--   deployed app names its key (products!implant_sites_product_id_fkey), and nothing embeds implant_sites from
--   products, so the second key makes no embed ambiguous (PGRST201) for the app version still running.
--   If an implant's planned product is missing from its company, this migration stops: that is a data question.
-- * fit_component_v2 goes (the app calls only fit_component_v3 since 0135), and so does
--   app_private.clear_wrong_closer_links(), which 0137 ran once.
-- * set_implant_geometry refuses a direction without an angle. Existing rows are left as they are.
set local lock_timeout = '5s';

-- ── Planned-product key ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
  from public.implant_sites s
  where s.planned_product_id is not null
    and not exists (select 1 from public.products p where p.company_id = s.company_id and p.id = s.planned_product_id);
  if v_missing > 0 then
    raise exception '0144: % implant(s) have a planned product that is not a product of their company; the key is not added', v_missing;
  end if;
end $$;

alter table public.implant_sites
  add constraint implant_sites_planned_product_id_fkey foreign key (company_id, planned_product_id)
    references public.products (company_id, id);

-- ── Old functions ──────────────────────────────────────────────────────────────────────────────────
drop function public.fit_component_v2(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid);
drop function app_private.clear_wrong_closer_links();

-- ── set_implant_geometry: 0140 plus "Give the angle as well as the direction." ──────────────────────
-- Same signature, so the owner (tenant_definer) and grants stay.
create or replace function public.set_implant_geometry(
  p_site uuid, p_type text, p_angulation numeric, p_direction text, p_anchorage text, p_entry text, p_trajectory text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_direction text := nullif(trim(p_direction), '');
  v_anchorage text := nullif(trim(p_anchorage), '');
  v_entry text := trim(coalesce(p_entry, ''));
  v_trajectory text := trim(coalesce(p_trajectory, ''));
begin
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Only a placed implant has a type and angle.');
  end if;
  if p_type is null or p_type not in ('conventional', 'tilted', 'zygomatic', 'pterygoid') then
    perform app_private.fail('Choose the implant type.');
  end if;
  if p_type = 'tilted' and p_angulation is null then
    perform app_private.fail('Enter the angle of the tilted implant.');
  end if;
  if p_angulation is not null and (p_angulation < 0 or p_angulation > 60) then
    perform app_private.fail('Enter an angle between 0 and 60°.');
  end if;
  if v_direction is not null and v_direction not in ('mesial', 'distal', 'buccal', 'palatal_lingual') then
    perform app_private.fail('Choose the direction of the angle.');
  end if;
  if v_direction is not null and p_angulation is null then
    perform app_private.fail('Give the angle as well as the direction.');
  end if;
  if p_type not in ('zygomatic', 'pterygoid') and (v_anchorage is not null or v_entry <> '' or v_trajectory <> '') then
    perform app_private.fail('Anchorage is only recorded for zygomatic and pterygoid implants.');
  end if;
  if v_anchorage is not null and v_anchorage not in ('zygoma', 'pterygoid_plate', 'tuberosity', 'other') then
    perform app_private.fail('Choose the anchorage.');
  end if;
  if char_length(v_entry) > 200 or char_length(v_trajectory) > 200 then
    perform app_private.fail('Keep the entry point and trajectory to 200 characters each.');
  end if;

  update public.implant_sites
  set implant_type = p_type, angulation_deg = p_angulation, angulation_direction = v_direction,
      anchorage = v_anchorage, entry_point = v_entry, trajectory = v_trajectory
  where id = p_site;
end $$;
