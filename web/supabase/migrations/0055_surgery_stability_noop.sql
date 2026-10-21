-- save_implant_surgery_v2 (0053): only touch implant_sites when torque, ISQ or bone type actually change.
-- An unchanged save otherwise bumped implant_sites.updated_at and wrote a History row, which made another
-- user's open scan / impression or failure-correction form fail with "changed by someone else".

create or replace function public.save_implant_surgery_v2(
  p_site uuid, p_extraction_date date, p_placement_timing text, p_soft_tissue_phenotype text, p_keratinized_mucosa_mm numeric,
  p_flap text, p_torque_type text, p_healing text, p_primary_closure text, p_grafting_performed text,
  p_torque numeric, p_isq numeric, p_bone_type text,
  p_expected_updated_at timestamptz
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_row public.implant_surgery;
begin
  perform app_private.require_perm('patients', 'edit');
  v_site := app_private.lock_placed_site(p_site);
  if p_extraction_date is not null and p_extraction_date > v_site.placed_on then
    perform app_private.fail(format('The extraction date can''t be after the placement date (%s).', v_site.placed_on));
  end if;
  if p_placement_timing = 'immediate' and p_extraction_date is not null and p_extraction_date <> v_site.placed_on then
    perform app_private.fail('An immediate placement is on the extraction day. Change the timing or the extraction date.');
  end if;
  if p_grafting_performed = 'no' and exists (select 1 from public.implant_grafts where site_id = p_site) then
    perform app_private.fail('This implant has grafts recorded. Delete them before setting Grafting performed to No.');
  end if;
  if p_torque is not null and (p_torque < 0 or p_torque > 150) then
    perform app_private.fail('Enter an insertion torque between 0 and 150 Ncm.');
  end if;
  if p_isq is not null and (p_isq < 0 or p_isq > 100) then
    perform app_private.fail('Enter an ISQ between 0 and 100.');
  end if;
  if p_bone_type is not null and p_bone_type not in ('D1', 'D2', 'D3', 'D4') then
    perform app_private.fail('Choose a bone type from D1 to D4.');
  end if;

  select * into v_row from public.implant_surgery where site_id = p_site for update;
  if found then
    if p_expected_updated_at is null or v_row.updated_at <> p_expected_updated_at then
      perform app_private.fail('These surgical details were changed by someone else. Reload to see them.');
    end if;
    update public.implant_surgery
    set extraction_date = p_extraction_date, placement_timing = p_placement_timing, soft_tissue_phenotype = p_soft_tissue_phenotype,
        keratinized_mucosa_mm = p_keratinized_mucosa_mm, flap = p_flap, torque_type = p_torque_type, healing = p_healing,
        primary_closure = p_primary_closure, grafting_performed = p_grafting_performed
    where site_id = p_site;
  else
    if p_expected_updated_at is not null then
      perform app_private.fail('These surgical details were changed by someone else. Reload to see them.');
    end if;
    insert into public.implant_surgery (site_id, extraction_date, placement_timing, soft_tissue_phenotype, keratinized_mucosa_mm,
      flap, torque_type, healing, primary_closure, grafting_performed)
    values (p_site, p_extraction_date, p_placement_timing, p_soft_tissue_phenotype, p_keratinized_mucosa_mm,
      p_flap, p_torque_type, p_healing, p_primary_closure, p_grafting_performed);
  end if;

  if (v_site.torque_ncm, v_site.isq, v_site.bone_type) is distinct from (p_torque, p_isq, p_bone_type) then
    update public.implant_sites
    set torque_ncm = p_torque, isq = p_isq, bone_type = p_bone_type
    where id = p_site;
  end if;
end $$;
