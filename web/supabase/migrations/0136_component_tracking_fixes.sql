-- Component tracking fixes (review of 0135):
-- * closing an abutment also closes the prosthetic screw that holds it (not one that holds a restoration);
-- * a healing or abutment fitting also closes a current final restoration recorded as a component (v2);
-- * every fitting, v2 included, records what it closed in replaced_by, and the rows v2 closed before this
--   migration get it too, so undoing a fitting reopens exactly what it closed and nothing else (no guessing);
-- * a scan body or impression coping entered by mistake can be undone (its stock returns);
-- * component_role refuses a type it does not know instead of returning null.

-- ── Roles: an unknown type is an error ──────────────────────────────────────────────────────────────
-- Same mapping as 0135 (the index over it stays valid).
create or replace function app_private.component_role(p_type public.component_type) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_role text := case p_type::text
    when 'cover_screw' then 'healing'
    when 'healing_abutment' then 'healing'
    when 'healing_cap' then 'healing'
    when 'ti_base' then 'abutment'
    when 'multi_unit' then 'abutment'
    when 'abutment' then 'abutment'
    when 'temporary_abutment' then 'abutment'
    when 'abutment_screw' then 'abutment_screw'
    when 'prosthetic_screw' then 'prosthetic_screw'
    when 'temporary_cylinder_screw' then 'prosthetic_screw'
    when 'scan_body' then 'transfer'
    when 'impression_coping' then 'transfer'
    when 'final_restoration' then 'legacy'
  end;
begin
  if v_role is null then
    raise exception 'No component role for %', p_type;
  end if;
  return v_role;
end $$;

-- ── What closed each row before 0135: v2 closed every current row when it fitted the next one, so the row
-- that closed X is the first live row fitted on that implant after it. Written without audit rows (no one
-- changed these records; the link is derived). ─────────────────────────────────────────────────────────────
alter table public.site_components disable trigger site_components_audit;
update public.site_components x set replaced_by = (
  select y.id from public.site_components y
  where y.site_id = x.site_id and y.voided_at is null and y.created_at > x.created_at
    and app_private.component_role(y.component_type) <> 'transfer'
  order by y.created_at, y.id
  limit 1
)
where x.removed_on is not null and x.voided_at is null and x.replaced_by is null
  and app_private.component_role(x.component_type) <> 'transfer';
alter table public.site_components enable trigger site_components_audit;

-- ── v2: unchanged (0117) except that it records what it closed ──────────────────────────────────────
create or replace function public.fit_component_v2(
  p_site uuid, p_type public.component_type, p_fitted_on date, p_product uuid, p_lot uuid, p_by_delegate uuid,
  p_by_organizer uuid, p_notes text, p_course uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_product public.products;
  v_id uuid := gen_random_uuid();
  v_stock boolean := public.module_on('inventory');
  v_closed uuid[];
begin
  perform app_private.require_perm('patients', 'edit');
  if (p_by_delegate is not null or p_course is not null) and not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be fitted to a placed implant.');
  end if;
  if p_fitted_on is null or p_fitted_on > public.cairo_today() then
    perform app_private.fail('Enter the date the component was fitted (today or earlier).');
  end if;
  if p_fitted_on < v_site.placed_on then
    perform app_private.fail('The component cannot be fitted before the implant was placed.');
  end if;
  if p_by_delegate is null and p_by_organizer is null then
    perform app_private.fail('Choose who fitted the component.');
  end if;
  if p_by_delegate is not null and not exists (select 1 from public.delegates where id = p_by_delegate and active) then
    perform app_private.fail('Choose an active delegate.');
  end if;
  if p_course is not null and not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose a course from the list.');
  end if;
  perform app_private.check_enrolled(p_course, p_by_delegate);
  if p_by_organizer is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = v_site.company_id and m.user_id = p_by_organizer
      and m.active and m.role in ('admin', 'organizer')
  ) then
    perform app_private.fail('Choose an active organizer.');
  end if;
  if not v_stock and p_lot is not null then
    perform app_private.fail('Stock batches are not used in your plan.');
  end if;
  if p_lot is not null and p_product is null then
    perform app_private.fail('Choose the product for this stock batch.');
  end if;
  if p_product is not null then
    select * into v_product from public.products where id = p_product and active;
    if not found then
      perform app_private.fail('Choose an active product from the catalog.');
    end if;
    if not app_private.component_accepts(p_type, v_product.type) then
      perform app_private.fail(format('That product is not a %s.', replace(p_type::text, '_', ' ')));
    end if;
    if v_stock then
      if p_lot is null then
        perform app_private.fail('Choose the stock batch used.');
      end if;
      perform app_private.lock_lot(p_lot, p_product, p_fitted_on);
    end if;
  end if;

  with closed as (
    update public.site_components set removed_on = p_fitted_on where site_id = p_site and removed_on is null
    returning id
  )
  select array_agg(id) into v_closed from closed;
  insert into public.site_components (
    id, company_id, site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id,
    fitted_by_organizer_id, notes, course_id
  ) values (
    v_id, v_site.company_id, p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate,
    p_by_organizer, coalesce(p_notes, ''), p_course
  );
  if v_closed is not null then
    update public.site_components set replaced_by = v_id where id = any(v_closed);
  end if;

  if p_product is not null and v_stock then
    perform app_private.insert_use(p_lot, v_site.patient_id, p_site, v_id);
  end if;
  if p_type = 'final_restoration' then
    update public.implant_sites set state = 'restored' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'restored');
  end if;
  return v_id;
end $$;

-- ── v3: 0135 plus closing the abutment's prosthetic screw and a legacy final restoration ─────────────
create or replace function public.fit_component_v3(
  p_site uuid, p_type public.component_type, p_fitted_on date, p_product uuid, p_lot uuid, p_by_delegate uuid,
  p_by_organizer uuid, p_notes text, p_course uuid, p_torque numeric, p_holds_component uuid, p_holds_restoration uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_product public.products;
  v_id uuid := gen_random_uuid();
  v_stock boolean := public.module_on('inventory');
  v_role text := app_private.component_role(p_type);
  v_abutment uuid;
  v_closed uuid[];
begin
  perform app_private.require_perm('patients', 'edit');
  if p_type = 'final_restoration' then
    perform app_private.fail('Record crowns and bridges in the Restoration tab.');
  end if;
  if (p_by_delegate is not null or p_course is not null) and not public.module_on('teaching') then
    perform app_private.fail('Courses, delegates and supervisors are not used in your plan.');
  end if;
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be fitted to a placed implant.');
  end if;
  if p_fitted_on is null or p_fitted_on > public.cairo_today() then
    perform app_private.fail('Enter the date the component was fitted (today or earlier).');
  end if;
  if p_fitted_on < v_site.placed_on then
    perform app_private.fail('The component cannot be fitted before the implant was placed.');
  end if;
  if p_by_delegate is null and p_by_organizer is null then
    perform app_private.fail('Choose who fitted the component.');
  end if;
  if p_by_delegate is not null and not exists (select 1 from public.delegates where id = p_by_delegate and active) then
    perform app_private.fail('Choose an active delegate.');
  end if;
  if p_course is not null and not exists (select 1 from public.courses where id = p_course) then
    perform app_private.fail('Choose a course from the list.');
  end if;
  perform app_private.check_enrolled(p_course, p_by_delegate);
  if p_by_organizer is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = v_site.company_id and m.user_id = p_by_organizer
      and m.active and m.role in ('admin', 'organizer')
  ) then
    perform app_private.fail('Choose an active organizer.');
  end if;
  if p_torque is not null and (p_torque < 0 or p_torque > 150) then
    perform app_private.fail('Enter a torque between 0 and 150 Ncm.');
  end if;
  if not v_stock and p_lot is not null then
    perform app_private.fail('Stock batches are not used in your plan.');
  end if;
  if p_lot is not null and p_product is null then
    perform app_private.fail('Choose the product for this stock batch.');
  end if;
  if p_product is not null then
    select * into v_product from public.products where id = p_product and active;
    if not found then
      perform app_private.fail('Choose an active product from the catalog.');
    end if;
    if not app_private.component_accepts(p_type, v_product.type) then
      perform app_private.fail(format('That product is not a %s.', replace(p_type::text, '_', ' ')));
    end if;
    if v_stock then
      if p_lot is null then
        perform app_private.fail('Choose the stock batch used.');
      end if;
      perform app_private.lock_lot(p_lot, p_product, p_fitted_on);
    end if;
  end if;

  select id into v_abutment from public.site_components
  where site_id = p_site and removed_on is null and app_private.component_role(component_type) = 'abutment';
  if v_role = 'abutment_screw' then
    if p_holds_restoration is not null or p_holds_component is null or p_holds_component is distinct from v_abutment then
      perform app_private.fail('Choose the abutment this screw holds.');
    end if;
  elsif v_role = 'prosthetic_screw' then
    if (p_holds_component is null) = (p_holds_restoration is null)
       or (p_holds_component is not null and p_holds_component is distinct from v_abutment)
       or (p_holds_restoration is not null and not exists (
             select 1 from public.restorations r
             join public.restoration_sites rs on rs.restoration_id = r.id and rs.site_id = p_site
             where r.id = p_holds_restoration and r.voided_at is null and r.ended_on is null)) then
      perform app_private.fail('Choose what this screw holds.');
    end if;
  elsif p_holds_component is not null or p_holds_restoration is not null then
    perform app_private.fail('Only screws hold another part.');
  end if;

  -- Close what this fitting replaces: the same role; healing and abutment replace each other and a final
  -- restoration recorded as a component (v2); an abutment that closes takes its abutment screw and the
  -- prosthetic screw that holds it. A scan body or impression coping is in and out the same day.
  if v_role <> 'transfer' then
    with closed as (
      update public.site_components s set removed_on = p_fitted_on
      where s.site_id = p_site and s.removed_on is null
        and (app_private.component_role(s.component_type) = v_role
          or (v_role in ('healing', 'abutment')
              and app_private.component_role(s.component_type) in ('healing', 'abutment', 'legacy'))
          or (v_role in ('healing', 'abutment') and v_abutment is not null
              and (app_private.component_role(s.component_type) = 'abutment_screw'
                   or (app_private.component_role(s.component_type) = 'prosthetic_screw'
                       and s.holds_component_id = v_abutment))))
      returning s.id
    )
    select array_agg(id) into v_closed from closed;
  end if;

  insert into public.site_components (
    id, company_id, site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id,
    fitted_by_organizer_id, notes, course_id, torque_ncm, holds_component_id, holds_restoration_id, removed_on
  ) values (
    v_id, v_site.company_id, p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate,
    p_by_organizer, coalesce(p_notes, ''), p_course, p_torque, p_holds_component, p_holds_restoration,
    case when v_role = 'transfer' then p_fitted_on end
  );
  if v_closed is not null then
    update public.site_components set replaced_by = v_id where id = any(v_closed);
  end if;

  if p_product is not null and v_stock then
    perform app_private.insert_use(p_lot, v_site.patient_id, p_site, v_id);
  end if;
  return v_id;
end $$;

-- ── Undo: reopen exactly what the fitting closed; a scan body or impression coping can be undone too ──
create or replace function public.void_component(p_component uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.site_components;
  v_site public.implant_sites;
  v_use uuid;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'reason for undoing this component');
  select * into v_c from public.site_components where id = p_component;
  if not found or v_c.voided_at is not null
     or (v_c.removed_on is not null and app_private.component_role(v_c.component_type) <> 'transfer') then
    perform app_private.fail('Only the current component can be undone.');
  end if;
  select * into v_site from public.implant_sites where id = v_c.site_id for update;
  if v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be changed on a placed implant.');
  end if;
  if exists (select 1 from public.site_components
             where holds_component_id = p_component and removed_on is null and voided_at is null) then
    perform app_private.fail('Undo the screw that holds this part first.');
  end if;
  if v_c.stock_lot_id is not null then
    v_use := app_private.unreversed_use(v_site.id, p_component, v_c.stock_lot_id);
    if v_use is not null then
      perform app_private.reverse_use(v_use, 'Undone: ' || trim(p_reason));
    end if;
  end if;
  update public.site_components
  set voided_at = now(), voided_by = app.current_user_id(), voided_reason = trim(p_reason), removed_on = fitted_on
  where id = p_component;

  -- Only a current row's fitting can be undone back: a closed transfer row reopens nothing.
  if v_c.removed_on is null then
    update public.site_components set removed_on = null, replaced_by = null
    where replaced_by = p_component and voided_at is null;
  end if;
  if v_c.component_type = 'final_restoration' then
    perform app_private.sync_restored(v_site.id);
  end if;
end $$;
