create type public.site_state as enum ('planned', 'placed', 'restored', 'failed', 'removed');
create type public.component_type as enum (
  'cover_screw', 'healing_abutment', 'ti_base', 'multi_unit', 'abutment', 'final_restoration'
);
create type public.followup_outcome as enum ('ok', 'integrated', 'failed', 'complication');

create table public.implant_sites (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  tooth public.fdi_tooth not null,
  state public.site_state not null default 'planned',
  product_id uuid references public.products (id),
  stock_lot_id uuid references public.stock_lots (id),
  placed_on date,
  torque_ncm numeric(5, 1) check (torque_ncm between 0 and 150),
  graft text not null default '' check (length(graft) <= 200),
  placing_delegate_id uuid references public.delegates (id),
  assisting_delegate_id uuid references public.delegates (id),
  supervisor_id uuid references public.profiles (user_id),
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint implant_sites_placed_details check (
    state in ('planned', 'removed')
    or (product_id is not null and stock_lot_id is not null and placed_on is not null
        and placing_delegate_id is not null and supervisor_id is not null)
  )
);
create unique index implant_sites_one_active on public.implant_sites (patient_id, tooth)
  where state not in ('failed', 'removed');
create index implant_sites_patient_idx on public.implant_sites (patient_id);

create table public.site_components (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.implant_sites (id) on delete cascade,
  component_type public.component_type not null,
  product_id uuid references public.products (id),
  stock_lot_id uuid references public.stock_lots (id),
  fitted_on date not null,
  fitted_by_delegate_id uuid references public.delegates (id),
  fitted_by_organizer_id uuid references public.profiles (user_id),
  removed_on date,
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id)
);
create unique index site_components_one_current on public.site_components (site_id) where removed_on is null;

create table public.implant_followups (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.implant_sites (id) on delete cascade,
  date date not null,
  check_type text not null check (length(trim(check_type)) between 1 and 60),
  outcome public.followup_outcome not null,
  notes text not null default '' check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id)
);
create index implant_followups_site_idx on public.implant_followups (site_id, date);

alter table public.stock_movements
  add constraint stock_movements_implant_site_fk foreign key (implant_site_id) references public.implant_sites (id),
  add constraint stock_movements_site_component_fk foreign key (site_component_id) references public.site_components (id);

create trigger implant_sites_set_updated_at before update on public.implant_sites
  for each row execute function app_private.set_updated_at();
create trigger implant_sites_audit after insert or update or delete on public.implant_sites
  for each row execute function app_private.audit_row('id');
create trigger site_components_audit after insert or update or delete on public.site_components
  for each row execute function app_private.audit_row('id');
create trigger implant_followups_audit after insert or update or delete on public.implant_followups
  for each row execute function app_private.audit_row('id');

revoke all on public.implant_sites, public.site_components, public.implant_followups from anon;
revoke insert, update, delete, truncate on public.implant_sites, public.site_components, public.implant_followups
  from authenticated;
alter table public.implant_sites enable row level security;
alter table public.site_components enable row level security;
alter table public.implant_followups enable row level security;
create policy implant_sites_select on public.implant_sites for select to authenticated using (public.is_active_user());
create policy site_components_select on public.site_components for select to authenticated using (public.is_active_user());
create policy implant_followups_select on public.implant_followups for select to authenticated using (public.is_active_user());

-- Helpers ----------------------------------------------------------------------------------------
create function app_private.set_tooth(p_patient uuid, p_tooth smallint, p_status public.tooth_state) returns void
language sql security definer set search_path = '' as $$
  insert into public.tooth_status (patient_id, tooth, status) values (p_patient, p_tooth, p_status)
  on conflict (patient_id, tooth) do update set status = excluded.status;
$$;

-- Takes one unit from a batch (locked), after checking product, expiry and stock.
create function app_private.take_one(p_lot uuid, p_product uuid, p_patient uuid, p_site uuid, p_component uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_lot public.stock_lots;
begin
  select * into v_lot from public.stock_lots where id = p_lot for update;
  if not found then
    perform app_private.fail('Choose a stock batch.');
  end if;
  if v_lot.product_id <> p_product then
    perform app_private.fail('That stock batch is for a different product.');
  end if;
  if v_lot.expiry is not null and v_lot.expiry < current_date then
    perform app_private.fail(format('Lot %s expired on %s. Choose another batch.',
      coalesce(v_lot.lot_no, '(no lot number)'), to_char(v_lot.expiry, 'YYYY-MM-DD')));
  end if;
  if app_private.lot_on_hand(p_lot) < 1 then
    perform app_private.fail('This stock batch is empty. Choose another batch or receive stock first.');
  end if;
  insert into public.stock_movements (stock_lot_id, delta, reason, implant_site_id, site_component_id, patient_id)
  values (p_lot, -1, 'use', p_site, p_component, p_patient);
end $$;

-- Business functions -------------------------------------------------------------------------------
create function public.plan_implant(p_patient uuid, p_tooth smallint, p_product uuid default null, p_notes text default '')
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform app_private.require_active();
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_product is not null and not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
    perform app_private.fail('Choose an implant from the catalog.');
  end if;
  if exists (select 1 from public.implant_sites where patient_id = p_patient and tooth = p_tooth and state not in ('failed', 'removed')) then
    perform app_private.fail(format('Tooth %s already has an implant record.', p_tooth));
  end if;
  insert into public.implant_sites (patient_id, tooth, state, product_id, notes)
  values (p_patient, p_tooth, 'planned', p_product, coalesce(p_notes, ''))
  returning id into v_id;
  perform app_private.set_tooth(p_patient, p_tooth, 'implant_planned');
  return v_id;
end $$;

create function public.cancel_planned_implant(p_site uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  perform app_private.require_active();
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state <> 'planned' then
    perform app_private.fail('Only a planned implant can be cancelled.');
  end if;
  update public.implant_sites set state = 'removed' where id = p_site;
  perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'missing');
end $$;

create function public.place_implant(
  p_patient uuid, p_tooth smallint, p_product uuid, p_lot uuid, p_placed_on date,
  p_placing_delegate uuid, p_supervisor uuid, p_assisting_delegate uuid default null,
  p_torque numeric default null, p_graft text default '', p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
  v_id uuid;
begin
  perform app_private.require_active();
  if not exists (select 1 from public.patients where id = p_patient) then
    perform app_private.fail('Patient not found.');
  end if;
  if p_placed_on is null or p_placed_on > current_date + 1 then
    perform app_private.fail('Enter the placement date (today or earlier).');
  end if;
  if not exists (select 1 from public.products where id = p_product and type = 'implant' and active) then
    perform app_private.fail('Choose an implant from the catalog.');
  end if;
  if p_placing_delegate is null or not exists (select 1 from public.delegates where id = p_placing_delegate and active) then
    perform app_private.fail('Choose the delegate who placed the implant.');
  end if;
  if p_assisting_delegate is not null then
    if p_assisting_delegate = p_placing_delegate then
      perform app_private.fail('The assisting delegate must be someone other than the placing delegate.');
    end if;
    if not exists (select 1 from public.delegates where id = p_assisting_delegate and active) then
      perform app_private.fail('Choose an active assisting delegate.');
    end if;
  end if;
  if p_supervisor is null or not exists (select 1 from public.profiles where user_id = p_supervisor and active) then
    perform app_private.fail('Choose the supervising organizer.');
  end if;
  if p_torque is not null and (p_torque < 0 or p_torque > 150) then
    perform app_private.fail('Enter an insertion torque between 0 and 150 Ncm.');
  end if;

  select * into v_site from public.implant_sites
  where patient_id = p_patient and tooth = p_tooth and state not in ('failed', 'removed')
  for update;
  if found and v_site.state <> 'planned' then
    perform app_private.fail(format('Tooth %s already has an implant.', p_tooth));
  end if;

  if found then
    update public.implant_sites
    set state = 'placed', product_id = p_product, stock_lot_id = p_lot, placed_on = p_placed_on,
        torque_ncm = p_torque, graft = coalesce(p_graft, ''), placing_delegate_id = p_placing_delegate,
        assisting_delegate_id = p_assisting_delegate, supervisor_id = p_supervisor,
        notes = coalesce(nullif(p_notes, ''), notes)
    where id = v_site.id
    returning id into v_id;
  else
    insert into public.implant_sites (
      patient_id, tooth, state, product_id, stock_lot_id, placed_on, torque_ncm, graft,
      placing_delegate_id, assisting_delegate_id, supervisor_id, notes
    ) values (
      p_patient, p_tooth, 'placed', p_product, p_lot, p_placed_on, p_torque, coalesce(p_graft, ''),
      p_placing_delegate, p_assisting_delegate, p_supervisor, coalesce(p_notes, '')
    ) returning id into v_id;
  end if;

  perform app_private.take_one(p_lot, p_product, p_patient, v_id, null);
  perform app_private.set_tooth(p_patient, p_tooth, 'implant_placed');
  return v_id;
end $$;

revoke execute on function public.plan_implant(uuid, smallint, uuid, text) from public, anon;
revoke execute on function public.cancel_planned_implant(uuid) from public, anon;
revoke execute on function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.plan_implant(uuid, smallint, uuid, text) to authenticated;
grant execute on function public.cancel_planned_implant(uuid) to authenticated;
grant execute on function public.place_implant(uuid, smallint, uuid, uuid, date, uuid, uuid, uuid, numeric, text, text) to authenticated;

-- History now includes the patient's implant records.
create or replace function public.patient_history(p_patient uuid)
returns table (id bigint, at timestamptz, table_name text, action text, actor text, before jsonb, after jsonb)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.at, a.table_name, a.action,
         coalesce(nullif(pr.full_name, ''), pr.email, 'System') as actor,
         a.before, a.after
  from public.audit_log a
  left join public.profiles pr on pr.user_id = a.user_id
  where (a.table_name in ('patients', 'medical_history') and a.row_id = p_patient::text)
     or (a.table_name in ('tooth_status', 'visit_notes', 'implant_sites')
         and coalesce(a.after ->> 'patient_id', a.before ->> 'patient_id') = p_patient::text)
  order by a.id desc
  limit 500;
$$;
