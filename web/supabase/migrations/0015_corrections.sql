alter table public.site_components
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles (user_id),
  add column voided_reason text not null default '' check (length(voided_reason) <= 300);
alter table public.implant_followups
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles (user_id),
  add column voided_reason text not null default '' check (length(voided_reason) <= 300);

create function app_private.require_reason(p_reason text, p_what text) returns void
language plpgsql as $$
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    perform app_private.fail(format('Explain the %s (at least 3 characters).', p_what));
  end if;
end $$;

create function app_private.unreversed_use(p_site uuid, p_component uuid, p_lot uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.stock_movements m
  where m.implant_site_id = p_site and m.reason = 'use'
    and m.site_component_id is not distinct from p_component
    and m.stock_lot_id = p_lot
    and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id)
  order by m.created_at desc
  limit 1;
$$;

create function app_private.reverse_use(p_use uuid, p_note text) returns void
language sql security definer set search_path = '' as $$
  insert into public.stock_movements (stock_lot_id, delta, reason, implant_site_id, site_component_id, patient_id, note, reverses_movement_id)
  select m.stock_lot_id, 1, 'adjust', m.implant_site_id, m.site_component_id, m.patient_id, p_note, m.id
  from public.stock_movements m where m.id = p_use;
$$;

create function public.correct_batch(
  p_site uuid, p_new_lot uuid, p_reason text, p_component uuid default null, p_new_product uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_comp public.site_components;
  v_product uuid;
  v_type public.product_type;
  v_old_lot uuid;
  v_use uuid;
begin
  perform app_private.require_active();
  perform app_private.require_reason(p_reason, 'correction');
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state in ('planned', 'removed') then
    perform app_private.fail('Only a placed implant has a batch to correct.');
  end if;
  if p_component is null then
    v_product := coalesce(p_new_product, v_site.product_id);
    if not exists (select 1 from public.products where id = v_product and type = 'implant' and active) then
      perform app_private.fail('Choose an implant from the catalog.');
    end if;
    v_old_lot := v_site.stock_lot_id;
  else
    select * into v_comp from public.site_components where id = p_component and site_id = p_site and voided_at is null;
    if not found then
      perform app_private.fail('Component not found.');
    end if;
    if v_comp.stock_lot_id is null then
      perform app_private.fail('This component was not taken from stock.');
    end if;
    v_product := coalesce(p_new_product, v_comp.product_id);
    select type into v_type from public.products where id = v_product and active;
    if not found or not app_private.component_accepts(v_comp.component_type, v_type) then
      perform app_private.fail(format('That product is not a %s.', replace(v_comp.component_type::text, '_', ' ')));
    end if;
    v_old_lot := v_comp.stock_lot_id;
  end if;
  if p_new_lot = v_old_lot then
    perform app_private.fail('Choose a different batch.');
  end if;
  v_use := app_private.unreversed_use(p_site, p_component, v_old_lot);
  if v_use is null then
    perform app_private.fail('The original stock entry was not found.');
  end if;

  perform app_private.lock_lot(p_new_lot, v_product);
  perform app_private.reverse_use(v_use, 'Correction: ' || trim(p_reason));
  perform app_private.insert_use(p_new_lot, v_site.patient_id, p_site, p_component);
  if p_component is null then
    update public.implant_sites set stock_lot_id = p_new_lot, product_id = v_product where id = p_site;
  else
    update public.site_components set stock_lot_id = p_new_lot, product_id = v_product where id = p_component;
  end if;
end $$;

create function public.void_followup(p_followup uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_f public.implant_followups;
  v_site public.implant_sites;
  v_state public.site_state;
begin
  perform app_private.require_active();
  perform app_private.require_reason(p_reason, 'reason for removing this follow-up');
  select * into v_f from public.implant_followups where id = p_followup and voided_at is null;
  if not found then
    perform app_private.fail('Follow-up not found.');
  end if;
  select * into v_site from public.implant_sites where id = v_f.site_id for update;
  update public.implant_followups
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason)
  where id = p_followup;

  if v_f.outcome = 'failed' and v_site.state = 'failed'
     and not exists (select 1 from public.implant_followups where site_id = v_site.id and outcome = 'failed' and voided_at is null) then
    if exists (
      select 1 from public.implant_sites
      where patient_id = v_site.patient_id and tooth = v_site.tooth and state not in ('failed', 'removed')
    ) then
      perform app_private.fail('A new implant is already recorded on this tooth, so the failure cannot be undone.');
    end if;
    v_state := case when exists (
      select 1 from public.site_components
      where site_id = v_site.id and removed_on is null and voided_at is null and component_type = 'final_restoration'
    ) then 'restored' else 'placed' end;
    update public.implant_sites set state = v_state where id = v_site.id;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint,
      case when v_state = 'restored' then 'restored' else 'implant_placed' end::public.tooth_state);
  end if;
end $$;

create function public.void_component(p_component uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_c public.site_components;
  v_site public.implant_sites;
  v_use uuid;
  v_prev uuid;
begin
  perform app_private.require_active();
  perform app_private.require_reason(p_reason, 'reason for undoing this component');
  select * into v_c from public.site_components where id = p_component;
  if not found or v_c.voided_at is not null or v_c.removed_on is not null then
    perform app_private.fail('Only the current component can be undone.');
  end if;
  select * into v_site from public.implant_sites where id = v_c.site_id for update;
  if v_site.state not in ('placed', 'restored') then
    perform app_private.fail('Components can only be changed on a placed implant.');
  end if;
  if v_c.stock_lot_id is not null then
    v_use := app_private.unreversed_use(v_site.id, p_component, v_c.stock_lot_id);
    if v_use is not null then
      perform app_private.reverse_use(v_use, 'Undone: ' || trim(p_reason));
    end if;
  end if;
  update public.site_components
  set voided_at = now(), voided_by = auth.uid(), voided_reason = trim(p_reason), removed_on = fitted_on
  where id = p_component;
  select id into v_prev from public.site_components
  where site_id = v_site.id and id <> p_component and voided_at is null
  order by fitted_on desc, created_at desc
  limit 1;
  if v_prev is not null then
    update public.site_components set removed_on = null where id = v_prev;
  end if;
  if v_c.component_type = 'final_restoration' and v_site.state = 'restored' then
    update public.implant_sites set state = 'placed' where id = v_site.id;
    perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'implant_placed');
  end if;
end $$;

create or replace function public.lot_usage(p_lot uuid)
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
    and not exists (select 1 from public.stock_movements r where r.reverses_movement_id = m.id)
  order by 2 desc, p.full_name;
$$;

revoke execute on function public.correct_batch(uuid, uuid, text, uuid, uuid) from public, anon;
revoke execute on function public.void_followup(uuid, text) from public, anon;
revoke execute on function public.void_component(uuid, text) from public, anon;
grant execute on function public.correct_batch(uuid, uuid, text, uuid, uuid) to authenticated;
grant execute on function public.void_followup(uuid, text) to authenticated;
grant execute on function public.void_component(uuid, text) to authenticated;
