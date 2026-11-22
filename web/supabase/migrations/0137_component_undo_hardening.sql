-- Component undo hardening (review of 0136):
-- * 0136's backfill linked each closed row to the next row entered on the implant. Before 0136 an undo
--   reopened the latest row by date, not by entry order, so after a back-dated fitting and an old undo that
--   link can be wrong. Every real closure (v2, v3, 0136) sets the closed row's removed_on to its closer's
--   fitted_on: links that don't match are cleared (the row then reopens with nothing).
-- * Undo refuses, instead of failing on the one-current-per-role index, when a part it would reopen has its
--   place taken by a newer current part.

-- Kept as a function so the test runs exactly this statement. Owner only (run by migrations).
create function app_private.clear_wrong_closer_links() returns void
language sql set search_path = '' as $$
  update public.site_components x set replaced_by = null
  where x.replaced_by is not null
    and x.removed_on is distinct from (select y.fitted_on from public.site_components y where y.id = x.replaced_by);
$$;
revoke execute on function app_private.clear_wrong_closer_links() from public, anon, authenticated;

-- Derived links, no one changed these records: no History entries (as 0136).
alter table public.site_components disable trigger site_components_audit;
select app_private.clear_wrong_closer_links();
alter table public.site_components enable trigger site_components_audit;

-- ── Undo: 0136's body plus the refusal when a reopened part's place is taken ────────────────────────
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
  if v_c.removed_on is null and exists (
    select 1 from public.site_components r
    join public.site_components o on o.site_id = r.site_id and o.removed_on is null and o.id <> p_component
      and app_private.component_role(o.component_type) = app_private.component_role(r.component_type)
    where r.replaced_by = p_component and r.voided_at is null
  ) then
    perform app_private.fail('Undo the newer part in the same place first.');
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
