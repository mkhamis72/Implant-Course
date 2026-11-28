-- Screw size on a fitted screw: site_components.screw_size_id references the company's screw_sizes (Admin →
-- Screw sizes, 0148). fit_component_v4 is 0138's fit_component_v3 plus p_screw_size (last parameter, no
-- default): a size is only for an abutment or prosthetic screw (a temporary cylinder screw counts as
-- prosthetic), must be of that kind, active and this company's. fit_component_v3 stays for the previous app
-- version. Additive.

alter table public.site_components add column screw_size_id uuid;
alter table public.site_components
  add constraint site_components_screw_size_fkey foreign key (screw_size_id) references public.screw_sizes (id);
create index site_components_screw_size_idx on public.site_components (screw_size_id) where screw_size_id is not null;

create function public.fit_component_v4(
  p_site uuid, p_type public.component_type, p_fitted_on date, p_product uuid, p_lot uuid, p_by_delegate uuid,
  p_by_organizer uuid, p_notes text, p_course uuid, p_torque numeric, p_holds_component uuid, p_holds_restoration uuid,
  p_screw_size uuid
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
  v_size public.screw_sizes;
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
  if p_screw_size is not null then
    if v_role not in ('abutment_screw', 'prosthetic_screw') then
      perform app_private.fail('A size is only for a screw.');
    end if;
    select * into v_size from public.screw_sizes where id = p_screw_size and company_id = v_site.company_id;
    if not found or not v_size.active then
      perform app_private.fail('Choose an active screw size.');
    end if;
    if v_size.kind <> v_role then
      perform app_private.fail('This size is for another kind of screw.');
    end if;
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
  elsif v_role = 'cap' then
    if p_holds_restoration is not null or p_holds_component is null or p_holds_component is distinct from v_abutment then
      perform app_private.fail('Choose the abutment this cap sits on.');
    end if;
  elsif p_holds_component is not null or p_holds_restoration is not null then
    perform app_private.fail('Only screws hold another part.');
  end if;

  -- Close what this fitting replaces: the same role; healing and abutment replace each other and a final
  -- restoration recorded as a component (v2); an abutment that closes takes what sits on it: its abutment
  -- screw, the prosthetic screws that hold it and its cap. A cap replaces only the current cap. A scan body
  -- or impression coping is in and out the same day.
  if v_role <> 'transfer' then
    with closed as (
      update public.site_components s set removed_on = p_fitted_on
      where s.site_id = p_site and s.removed_on is null
        and (app_private.component_role(s.component_type) = v_role
          or (v_role in ('healing', 'abutment')
              and app_private.component_role(s.component_type) in ('healing', 'abutment', 'legacy'))
          or (v_role in ('healing', 'abutment') and v_abutment is not null
              and (app_private.component_role(s.component_type) = 'abutment_screw'
                   or (app_private.component_role(s.component_type) in ('prosthetic_screw', 'cap')
                       and s.holds_component_id = v_abutment))))
      returning s.id
    )
    select array_agg(id) into v_closed from closed;
  end if;

  insert into public.site_components (
    id, company_id, site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id,
    fitted_by_organizer_id, notes, course_id, torque_ncm, holds_component_id, holds_restoration_id, removed_on, screw_size_id
  ) values (
    v_id, v_site.company_id, p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate,
    p_by_organizer, coalesce(p_notes, ''), p_course, p_torque, p_holds_component, p_holds_restoration,
    case when v_role = 'transfer' then p_fitted_on end, p_screw_size
  );
  if v_closed is not null then
    update public.site_components set replaced_by = v_id where id = any(v_closed);
  end if;

  if p_product is not null and v_stock then
    perform app_private.insert_use(p_lot, v_site.patient_id, p_site, v_id);
  end if;
  return v_id;
end $$;

-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it), as in 0135.
grant create on schema public, app_private to tenant_definer;
alter function public.fit_component_v4(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid, numeric, uuid, uuid, uuid)
  owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;
revoke execute on function public.fit_component_v4(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid, numeric, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.fit_component_v4(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text, uuid, numeric, uuid, uuid, uuid)
  to authenticated;
