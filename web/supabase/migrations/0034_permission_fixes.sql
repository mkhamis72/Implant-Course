-- Review fixes for 0030–0033.

-- 1. Default View rows only for a new organizer or a real role change: re-saving the same role must not
--    turn "None everywhere" into "View everywhere".
create or replace function app_private.default_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.role is not distinct from new.role then
    return new;
  end if;
  if new.role = 'organizer' and not exists (select 1 from public.user_permissions where user_id = new.user_id) then
    insert into public.user_permissions (user_id, area, level)
    select new.user_id, a.area, 'view'
    from (values ('patients'), ('schedule'), ('courses'), ('checklists'), ('inventory'), ('delegates')) as a (area);
  end if;
  return new;
end $$;

-- 2. Area policies evaluate the permission once per query: `(select can(...))` becomes an InitPlan instead of
--    a function call per row. Same rules as 0030 + 0032 + 0033.
create function app_private.recreate_area_policies(p_table text, p_area text, p_read text) returns void
language plpgsql set search_path = '' as $$
declare
  v_edit text := format('(select public.can(%L, ''edit''))', p_area);
begin
  execute format('drop policy %I on public.%I', p_table || '_area_read', p_table);
  execute format('drop policy %I on public.%I', p_table || '_area_insert', p_table);
  execute format('drop policy %I on public.%I', p_table || '_area_update', p_table);
  execute format('drop policy %I on public.%I', p_table || '_area_delete', p_table);
  execute format('create policy %I on public.%I as restrictive for select to authenticated using (%s)',
    p_table || '_area_read', p_table, p_read);
  execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (%s)',
    p_table || '_area_insert', p_table, v_edit);
  execute format('create policy %I on public.%I as restrictive for update to authenticated using (%s) with check (%s)',
    p_table || '_area_update', p_table, v_edit, v_edit);
  execute format('create policy %I on public.%I as restrictive for delete to authenticated using (%s)',
    p_table || '_area_delete', p_table, v_edit);
end $$;

create function app_private.view_of(variadic p_areas text[]) returns text
language sql immutable set search_path = '' as $$
  select string_agg(format('(select public.can(%L, ''view''))', a), ' or ') from unnest(p_areas) a;
$$;

select app_private.recreate_area_policies('patients', 'patients', app_private.view_of('patients', 'schedule'));
select app_private.recreate_area_policies(t, 'patients', app_private.view_of('patients')) from unnest(array[
  'medical_history', 'visit_notes', 'tooth_status', 'site_components', 'implant_followups', 'audit_log']) t;
select app_private.recreate_area_policies('implant_sites', 'patients', app_private.view_of('patients', 'schedule'));
select app_private.recreate_area_policies(t, 'schedule', app_private.view_of('schedule', 'patients')) from unnest(array[
  'surgery_slots', 'slot_delegates', 'slot_planned_implants']) t;
select app_private.recreate_area_policies('talks', 'schedule', app_private.view_of('schedule'));
select app_private.recreate_area_policies(t, 'courses', app_private.view_of('courses', 'schedule')) from unnest(array[
  'courses', 'sessions', 'enrollments']) t;
select app_private.recreate_area_policies(t, 'checklists', app_private.view_of('checklists')) from unnest(array[
  'checklist_templates', 'template_items', 'checklists', 'checklist_items']) t;
select app_private.recreate_area_policies('stock_movements', 'inventory', app_private.view_of('inventory', 'patients', 'schedule'));
select app_private.recreate_area_policies('products', 'inventory', 'true');
select app_private.recreate_area_policies('delegates', 'delegates', 'true');

drop function app_private.recreate_area_policies(text, text, text);
drop function app_private.view_of(text[]);
