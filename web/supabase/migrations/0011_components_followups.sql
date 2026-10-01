create function app_private.component_accepts(p_component public.component_type, p_product public.product_type)
returns boolean
language sql immutable as $$
  select case p_component
    when 'cover_screw' then p_product = 'cover_screw'
    when 'healing_abutment' then p_product = 'healing_abutment'
    when 'ti_base' then p_product = 'ti_base'
    when 'multi_unit' then p_product = 'multi_unit'
    when 'abutment' then p_product in ('abutment_straight', 'abutment_angled')
    when 'final_restoration' then p_product = 'other'
  end;
$$;

create function public.fit_component(
  p_site uuid, p_type public.component_type, p_fitted_on date, p_product uuid default null,
  p_lot uuid default null, p_by_delegate uuid default null, p_by_organizer uuid default null,
  p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_product public.products;
  v_id uuid;
begin
  perform app_private.require_active();
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be fitted to a placed implant.');
  end if;
  if p_fitted_on is null or p_fitted_on > current_date + 1 then
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
  if p_by_organizer is not null and not exists (select 1 from public.profiles where user_id = p_by_organizer and active) then
    perform app_private.fail('Choose an active organizer.');
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
    if p_lot is null then
      perform app_private.fail('Choose the stock batch used.');
    end if;
  end if;

  update public.site_components set removed_on = p_fitted_on where site_id = p_site and removed_on is null;
  insert into public.site_components (
    site_id, component_type, product_id, stock_lot_id, fitted_on, fitted_by_delegate_id, fitted_by_organizer_id, notes
  ) values (
    p_site, p_type, p_product, p_lot, p_fitted_on, p_by_delegate, p_by_organizer, coalesce(p_notes, '')
  ) returning id into v_id;

  if p_product is not null then
    perform app_private.take_one(p_lot, p_product, v_site.patient_id, p_site, v_id);
  end if;
  if p_type = 'final_restoration' then
    update public.implant_sites set state = 'restored' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'restored');
  end if;
  return v_id;
end $$;

create function public.record_followup(
  p_site uuid, p_date date, p_check_type text, p_outcome public.followup_outcome, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_id uuid;
begin
  perform app_private.require_active();
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored', 'failed') then
    perform app_private.fail('Follow-ups are recorded for placed implants.');
  end if;
  if p_date is null or p_date > current_date + 1 then
    perform app_private.fail('Enter the follow-up date (today or earlier).');
  end if;
  if p_date < v_site.placed_on then
    perform app_private.fail('A follow-up cannot be before the implant was placed.');
  end if;
  if length(trim(coalesce(p_check_type, ''))) = 0 then
    perform app_private.fail('Enter the check (e.g. 3-month).');
  end if;
  insert into public.implant_followups (site_id, date, check_type, outcome, notes)
  values (p_site, p_date, trim(p_check_type), p_outcome, coalesce(p_notes, ''))
  returning id into v_id;
  if p_outcome = 'failed' and v_site.state <> 'failed' then
    update public.implant_sites set state = 'failed' where id = p_site;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'failed');
  end if;
  return v_id;
end $$;

create function public.lot_usage(p_lot uuid)
returns table (
  movement_id uuid, used_on date, patient_id uuid, patient_name text, file_no text, tooth smallint,
  item text, placing_delegate text, supervisor text
)
language sql stable security invoker set search_path = '' as $$
  select m.id, coalesce(sc.fitted_on, s.placed_on), p.id, p.full_name, p.file_no, s.tooth::smallint,
         case when m.site_component_id is null then 'implant' else sc.component_type::text end,
         d.full_name, coalesce(nullif(pr.full_name, ''), pr.email)
  from public.stock_movements m
  join public.implant_sites s on s.id = m.implant_site_id
  join public.patients p on p.id = s.patient_id
  left join public.site_components sc on sc.id = m.site_component_id
  left join public.delegates d on d.id = s.placing_delegate_id
  left join public.profiles pr on pr.user_id = s.supervisor_id
  where m.stock_lot_id = p_lot and m.reason = 'use'
  order by 2 desc, p.full_name;
$$;

revoke execute on function public.fit_component(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.record_followup(uuid, date, text, public.followup_outcome, text) from public, anon;
revoke execute on function public.lot_usage(uuid) from public, anon;
grant execute on function public.fit_component(uuid, public.component_type, date, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.record_followup(uuid, date, text, public.followup_outcome, text) to authenticated;
grant execute on function public.lot_usage(uuid) to authenticated;
