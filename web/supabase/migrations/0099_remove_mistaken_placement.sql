set local lock_timeout = '5s';

-- Removing an implant entered by mistake (wrong tooth, wrong or duplicate patient), and deleting a duplicate
-- patient who has implants. Both erase the entry as if it was never made: the placement and everything
-- recorded on it go, and so do its stock movements (the use, any reversal of it, the new use of a batch
-- correction, and the same for its components), so every batch is back where it was before the placement.
--
-- stock_movements stays append-only for everything else: ledger_immutable lets a DELETE through only while
-- app.ledger_purge is 'on' in the transaction, which only these two functions set (and switch off again);
-- signed-in users have no DELETE privilege on the table either. UPDATE and TRUNCATE are always refused.
--
-- The reason is kept on the implant row just before it is deleted (removal_reason), so the deletion's audit
-- row holds who, when, why and what (tooth, product, batch, dates); the patient's History shows it.

alter table public.implant_sites add column removal_reason text;

create or replace function app_private.ledger_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.ledger_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'stock_movements is append-only';
end $$;

create function public.remove_placement(p_site uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_site public.implant_sites;
begin
  perform app_private.require_perm('patients', 'edit');
  perform app_private.require_reason(p_reason, 'reason for removing this implant');
  -- Lock order: site, then batch (0012).
  select * into v_site from public.implant_sites where id = p_site for update;
  if not found or v_site.state not in ('placed', 'restored', 'failed') then
    perform app_private.fail('Only a placed implant can be removed.');
  end if;
  if exists (select 1 from public.restoration_sites rs join public.restorations r on r.id = rs.restoration_id
             where rs.site_id = p_site and r.voided_at is null) then
    perform app_private.fail('This implant is part of a restoration on record: undo the restoration first.');
  end if;
  perform 1 from public.stock_lots l
  where l.id in (select m.stock_lot_id from public.stock_movements m
                 where m.implant_site_id = p_site
                    or m.site_component_id in (select sc.id from public.site_components sc where sc.site_id = p_site))
  order by l.id
  for update;

  update public.implant_sites set removal_reason = trim(p_reason) where id = p_site;
  perform set_config('app.ledger_purge', 'on', true);
  delete from public.stock_movements m
  where m.implant_site_id = p_site
     or m.site_component_id in (select sc.id from public.site_components sc where sc.site_id = p_site);
  perform set_config('app.ledger_purge', 'off', true);
  delete from app_private.research_codes where entity = 'implant' and entity_id = p_site;
  -- Components, surgical details, grafts, visits, complications, bone levels and restoration links go by cascade.
  delete from public.implant_sites where id = p_site;
  perform app_private.set_tooth(v_site.patient_id, v_site.tooth::smallint, 'missing');
end $$;

-- Same signature as 0030, so its grants stay. A patient with implants or components is deleted too now,
-- with their stock movements (the stock returns); the confirmation in the app says so.
create or replace function public.delete_patient(p_patient uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_perm('patients', 'edit');
  perform 1 from public.patients where id = p_patient for update;
  if not found then
    perform app_private.fail('Patient not found.');
  end if;
  -- Lock order: sites, then batches.
  perform 1 from public.implant_sites where patient_id = p_patient order by id for update;
  perform 1 from public.stock_lots l
  where l.id in (select m.stock_lot_id from public.stock_movements m
                 where m.patient_id = p_patient
                    or m.implant_site_id in (select s.id from public.implant_sites s where s.patient_id = p_patient)
                    or m.site_component_id in (
                      select sc.id from public.site_components sc
                      join public.implant_sites s on s.id = sc.site_id where s.patient_id = p_patient))
  order by l.id
  for update;

  perform set_config('app.ledger_purge', 'on', true);
  delete from public.stock_movements m
  where m.patient_id = p_patient
     or m.implant_site_id in (select s.id from public.implant_sites s where s.patient_id = p_patient)
     or m.site_component_id in (
       select sc.id from public.site_components sc
       join public.implant_sites s on s.id = sc.site_id where s.patient_id = p_patient);
  perform set_config('app.ledger_purge', 'off', true);
  delete from app_private.research_codes
  where (entity = 'patient' and entity_id = p_patient)
     or (entity = 'implant' and entity_id in (select s.id from public.implant_sites s where s.patient_id = p_patient))
     or (entity = 'restoration' and entity_id in (select r.id from public.restorations r where r.patient_id = p_patient));
  delete from public.surgery_slots where patient_id = p_patient;
  delete from public.patients where id = p_patient;
end $$;

-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it).
grant create on schema public to tenant_definer;
alter function public.remove_placement(uuid, text) owner to tenant_definer;
revoke create on schema public from tenant_definer;

revoke all on function public.remove_placement(uuid, text) from public, anon;
grant execute on function public.remove_placement(uuid, text) to authenticated;
