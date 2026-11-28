-- Screw sizes: a company's list of abutment and prosthetic screw sizes per implant system (brand + system),
-- with the screwdriver and recommended torque to use. Admin → Screw sizes writes it through the two definers
-- below; staff with Patients view read it. Additive: nothing existing changes.

create table public.screw_sizes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default app.current_company_id(),
  brand text not null check (char_length(brand) between 1 and 80),
  system text not null check (char_length(system) between 1 and 80),
  kind text not null check (kind in ('abutment_screw', 'prosthetic_screw')),
  label text not null check (char_length(label) between 1 and 40),
  driver_interface text not null default '' check (char_length(driver_interface) <= 60),
  driver_size text not null default '' check (char_length(driver_size) <= 30),
  driver_ref text not null default '' check (char_length(driver_ref) <= 60),
  torque_ncm numeric(5,1) check (torque_ncm between 0 and 150),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint screw_sizes_company_id_fkey foreign key (company_id) references public.companies (id),
  constraint screw_sizes_company_id_key unique (company_id, id),
  constraint screw_sizes_label_key unique (company_id, brand, system, kind, label)
);
create trigger screw_sizes_set_updated_at before update on public.screw_sizes
  for each row execute function app_private.set_updated_at();
create trigger screw_sizes_audit after insert or update or delete on public.screw_sizes
  for each row execute function app_private.audit_row('id');

-- tenant_definer gets its table privileges from 0092's default privileges.
revoke all on public.screw_sizes from public, anon, authenticated;
grant select on public.screw_sizes to authenticated;

alter table public.screw_sizes enable row level security;
alter table public.screw_sizes force row level security;
create policy screw_sizes_select on public.screw_sizes for select to authenticated
  using (public.is_active_user());
create policy screw_sizes_area_read on public.screw_sizes as restrictive for select to authenticated
  using (((select public.can('patients', 'view')) or (select public.is_admin())));
create policy screw_sizes_tenant_definer on public.screw_sizes for all to tenant_definer
  using (true) with check (true);
create policy screw_sizes_company_select on public.screw_sizes as restrictive for select to public
  using (company_id = (select app.current_company_id()));
create policy screw_sizes_company_insert on public.screw_sizes as restrictive for insert to public
  with check (company_id = (select app.current_company_id()));
create policy screw_sizes_company_update on public.screw_sizes as restrictive for update to public
  using (company_id = (select app.current_company_id())) with check (company_id = (select app.current_company_id()));
create policy screw_sizes_company_delete on public.screw_sizes as restrictive for delete to public
  using (company_id = (select app.current_company_id()));

-- Admin only, no area (as set_passport_settings, 0145). p_id null adds a size; otherwise edits that one.
create function public.save_screw_size(
  p_id uuid, p_brand text, p_system text, p_kind text, p_label text,
  p_driver_interface text, p_driver_size text, p_driver_ref text, p_torque numeric
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_brand text := btrim(coalesce(p_brand, ''));
  v_system text := btrim(coalesce(p_system, ''));
  v_label text := btrim(coalesce(p_label, ''));
  v_interface text := btrim(coalesce(p_driver_interface, ''));
  v_size text := btrim(coalesce(p_driver_size, ''));
  v_ref text := btrim(coalesce(p_driver_ref, ''));
  v_id uuid;
begin
  perform app_private.require_active();
  perform app_private.admin_company('Only an admin can change screw sizes.', false);
  if v_brand = '' or v_system = '' then
    perform app_private.fail('Choose the implant system.');
  end if;
  if p_kind is null or p_kind not in ('abutment_screw', 'prosthetic_screw') then
    perform app_private.fail('Choose abutment screw or prosthetic screw.');
  end if;
  if char_length(v_label) not between 1 and 40 then
    perform app_private.fail('Enter the screw size (up to 40 characters).');
  end if;
  if char_length(v_interface) > 60 or char_length(v_size) > 30 or char_length(v_ref) > 60 then
    perform app_private.fail('The screwdriver details are too long.');
  end if;
  if p_torque is not null and (p_torque < 0 or p_torque > 150) then
    perform app_private.fail('Torque must be between 0 and 150 Ncm.');
  end if;
  begin
    if p_id is null then
      insert into public.screw_sizes (brand, system, kind, label, driver_interface, driver_size, driver_ref, torque_ncm)
      values (v_brand, v_system, p_kind, v_label, v_interface, v_size, v_ref, round(p_torque, 1))
      returning id into v_id;
    else
      update public.screw_sizes
         set brand = v_brand, system = v_system, kind = p_kind, label = v_label, driver_interface = v_interface,
             driver_size = v_size, driver_ref = v_ref, torque_ncm = round(p_torque, 1)
       where id = p_id
      returning id into v_id;
      if v_id is null then
        perform app_private.fail('Screw size not found.');
      end if;
    end if;
  exception when unique_violation then
    perform app_private.fail('This system already has a screw of that kind with that size.');
  end;
  return v_id;
end $$;

create function public.set_screw_size_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  perform app_private.admin_company('Only an admin can change screw sizes.', false);
  update public.screw_sizes set active = coalesce(p_active, true) where id = p_id;
  if not found then
    perform app_private.fail('Screw size not found.');
  end if;
end $$;

-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it).
grant create on schema public, app_private to tenant_definer;
alter function public.save_screw_size(uuid, text, text, text, text, text, text, text, numeric) owner to tenant_definer;
alter function public.set_screw_size_active(uuid, boolean) owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;

revoke execute on function public.save_screw_size(uuid, text, text, text, text, text, text, text, numeric) from public, anon;
revoke execute on function public.set_screw_size_active(uuid, boolean) from public, anon;
grant execute on function public.save_screw_size(uuid, text, text, text, text, text, text, text, numeric) to authenticated;
grant execute on function public.set_screw_size_active(uuid, boolean) to authenticated;
