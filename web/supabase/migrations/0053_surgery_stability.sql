-- Insertion torque, ISQ and bone type are recorded in Surgical details (save_implant_surgery_v2), not on the
-- Place / Correct placement forms. The columns stay on implant_sites.
-- save_implant_surgery (0044) stays for the previous app version during a release.

create function public.save_implant_surgery_v2(
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

  update public.implant_sites
  set torque_ncm = p_torque, isq = p_isq, bone_type = p_bone_type
  where id = p_site;
end $$;

revoke execute on function public.save_implant_surgery_v2(uuid, date, text, text, numeric, text, text, text, text, text, numeric, numeric, text, timestamptz) from public, anon;
grant execute on function public.save_implant_surgery_v2(uuid, date, text, text, numeric, text, text, text, text, text, numeric, numeric, text, timestamptz) to authenticated;

-- correct_placement: latest 0049_failure_fixes.sql, minus the stability values.
create or replace function public.correct_placement(
  p_site uuid, p_placed_on date, p_placing_delegate uuid, p_assisting_delegate uuid, p_supervisor uuid,
  p_torque numeric, p_isq numeric, p_bone_type text, p_graft text, p_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_first date;
  v_lot public.stock_lots;
begin
  -- p_torque, p_isq and p_bone_type are ignored since 0053: they are recorded in Surgical details.
  perform app_private.require_perm('patients', 'edit');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Only a placed implant has placement details to correct.');
  end if;

  if p_placed_on is null or p_placed_on > public.cairo_today() then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  -- Components, follow-ups, complications and the failure can't predate the placement.
  select min(d) into v_first from (
    select fitted_on as d from public.site_components where site_id = p_site and voided_at is null
    union all
    select date from public.implant_followups where site_id = p_site and voided_at is null
    union all
    select v_site.failed_on
    union all
    select noticed_on from public.implant_complications where site_id = p_site and voided_at is null
  ) x;
  if v_first is not null and p_placed_on > v_first then
    perform app_private.fail(format('The implant can''t be placed after its first component, follow-up, complication or failure (%s).', v_first));
  end if;
  select * into v_lot from public.stock_lots where id = v_site.stock_lot_id;
  if v_lot.expiry is not null and v_lot.expiry < p_placed_on then
    perform app_private.fail(format('Lot %s expired on %s, before %s. Correct the batch first.',
      coalesce(v_lot.lot_no, '(no number)'), v_lot.expiry, p_placed_on));
  end if;

  -- People: active, or the one already recorded (they may have become inactive since).
  if p_placing_delegate is null or not exists (
    select 1 from public.delegates where id = p_placing_delegate and (active or id = v_site.placing_delegate_id)
  ) then
    perform app_private.fail('Choose the delegate who placed the implant.');
  end if;
  if p_assisting_delegate is not null then
    if p_assisting_delegate = p_placing_delegate then
      perform app_private.fail('The assisting delegate must be someone other than the placing delegate.');
    end if;
    if not exists (
      select 1 from public.delegates where id = p_assisting_delegate and (active or id = v_site.assisting_delegate_id)
    ) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
  end if;
  if p_supervisor is null or not exists (
    select 1 from public.supervisors where id = p_supervisor and (active or id = v_site.supervisor_id)
  ) then
    perform app_private.fail('Choose an active supervisor.');
  end if;

  update public.implant_sites
  set placed_on = p_placed_on, placing_delegate_id = p_placing_delegate, assisting_delegate_id = p_assisting_delegate,
      supervisor_id = p_supervisor, graft = coalesce(p_graft, ''), notes = coalesce(p_notes, '')
  where id = p_site;
end $$;
