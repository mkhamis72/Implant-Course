-- Component tracking (project B): an implant carries several components at once, one current row per role
-- (healing, abutment, abutment screw, prosthetic screw), with torque, what a screw holds and what replaced a
-- closed row. fit_component_v3 fits by role; fit_component_v2 stays for the previous app version (it still
-- closes every current row, which the per-role index allows). void_component reopens what a fitting closed.

-- ── Columns ─────────────────────────────────────────────────────────────────────────────────────────
-- Composite keys (0091): a row can only name a part or restoration of its own company. Indexed as 0114 does.
alter table public.site_components
  add column torque_ncm numeric(5,1) check (torque_ncm between 0 and 150),
  add column holds_component_id uuid,
  add column holds_restoration_id uuid,
  add column replaced_by uuid,
  add constraint site_components_holds_component_id_fkey foreign key (company_id, holds_component_id)
    references public.site_components (company_id, id),
  add constraint site_components_holds_restoration_id_fkey foreign key (company_id, holds_restoration_id)
    references public.restorations (company_id, id),
  add constraint site_components_replaced_by_fkey foreign key (company_id, replaced_by)
    references public.site_components (company_id, id);
create index site_components_holds_component_id_idx on public.site_components (company_id, holds_component_id);
create index site_components_holds_restoration_id_idx on public.site_components (company_id, holds_restoration_id);
create index site_components_replaced_by_idx on public.site_components (company_id, replaced_by);

-- ── Roles ───────────────────────────────────────────────────────────────────────────────────────────
create function app_private.component_role(p_type public.component_type) returns text
language sql immutable set search_path = '' as $$
  select case p_type::text
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
$$;

-- Existing data has at most one current row per implant, so this is safe to create.
drop index public.site_components_one_current;
create unique index site_components_one_current_role
  on public.site_components (site_id, app_private.component_role(component_type)) where removed_on is null;

-- ── Products each component accepts (0011's pairs kept) ─────────────────────────────────────────────
create or replace function app_private.component_accepts(p_component public.component_type, p_product public.product_type)
returns boolean
language sql immutable set search_path = '' as $$
  select case p_component::text
    when 'cover_screw' then p_product = 'cover_screw'
    when 'healing_abutment' then p_product = 'healing_abutment'
    when 'ti_base' then p_product = 'ti_base'
    when 'multi_unit' then p_product = 'multi_unit'
    when 'abutment' then p_product in ('abutment_straight', 'abutment_angled')
    when 'final_restoration' then p_product = 'other'
    when 'healing_cap' then p_product = 'healing_cap'
    when 'temporary_abutment' then p_product = 'temporary_abutment'
    when 'scan_body' then p_product = 'scan_body'
    when 'impression_coping' then p_product = 'impression_coping'
    when 'abutment_screw' then p_product = 'abutment_screw'
    when 'prosthetic_screw' then p_product = 'prosthetic_screw'
    when 'temporary_cylinder_screw' then p_product = 'prosthetic_screw'
  end;
$$;

-- ── Fitting by role ─────────────────────────────────────────────────────────────────────────────────
-- 0117's fit_component_v2 checks and messages, plus torque, what a screw holds, and closing by role.
create function public.fit_component_v3(
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

  -- What a screw holds: an abutment screw this implant's current abutment; a prosthetic screw that abutment or
  -- a live restoration on this implant. Nothing else holds a part.
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

  -- Close what this fitting replaces: the same role; healing and abutment replace each other; an abutment that
  -- closes takes its abutment screw with it. A scan body or impression coping is in and out the same day.
  -- Closed first (one current row per role), then marked with the new row once it exists.
  if v_role <> 'transfer' then
    with closed as (
      update public.site_components s set removed_on = p_fitted_on
      where s.site_id = p_site and s.removed_on is null
        and (app_private.component_role(s.component_type) = v_role
          or (v_role = 'healing' and app_private.component_role(s.component_type) = 'abutment')
          or (v_role = 'abutment' and app_private.component_role(s.component_type) = 'healing')
          or (v_role in ('healing', 'abutment') and v_abutment is not null
              and app_private.component_role(s.component_type) = 'abutment_screw'))
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

-- ── Undo: reopen what the fitting closed (0089's body otherwise) ────────────────────────────────────
create or replace function public.void_component(p_component uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.site_components;
  v_site public.implant_sites;
  v_use uuid;
  v_prev uuid;
  v_reopened int;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'reason for undoing this component');
  select * into v_c from public.site_components where id = p_component;
  if not found or v_c.voided_at is not null or v_c.removed_on is not null then
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

  -- A fitting by role (v3) marked what it closed.
  update public.site_components set removed_on = null, replaced_by = null
  where replaced_by = p_component and voided_at is null;
  get diagnostics v_reopened = row_count;

  -- A v2 fitting marked nothing: as v2 did, reopen the latest earlier row of its slot that no later fitting by
  -- role closed (healing, abutment and the old final restoration were one slot), unless its role is taken.
  if v_reopened = 0 then
    select s.id into v_prev from public.site_components s
    where s.site_id = v_site.id and s.id <> p_component and s.voided_at is null
      and s.removed_on is not null and s.replaced_by is null
      and app_private.component_role(s.component_type) <> 'transfer'
      and (case when app_private.component_role(s.component_type) in ('healing', 'abutment', 'legacy') then 'slot'
                else app_private.component_role(s.component_type) end)
        = (case when app_private.component_role(v_c.component_type) in ('healing', 'abutment', 'legacy') then 'slot'
                else app_private.component_role(v_c.component_type) end)
      and not exists (select 1 from public.site_components o
                      where o.site_id = s.site_id and o.removed_on is null
                        and app_private.component_role(o.component_type) = app_private.component_role(s.component_type))
    order by s.fitted_on desc, s.created_at desc
    limit 1;
    if v_prev is not null then
      update public.site_components set removed_on = null where id = v_prev;
    end if;
  end if;
  if v_c.component_type = 'final_restoration' then
    perform app_private.sync_restored(v_site.id);
  end if;
end $$;

-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it), as in 0132.
grant create on schema public, app_private to tenant_definer;
alter function public.fit_component_v3(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid, numeric, uuid, uuid)
  owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;
revoke execute on function public.fit_component_v3(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid, numeric, uuid, uuid)
  from public, anon;
grant execute on function public.fit_component_v3(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid, numeric, uuid, uuid)
  to authenticated;
