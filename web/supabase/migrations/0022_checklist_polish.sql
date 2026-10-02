-- General templates are never attached automatically, so they cannot be the default.
update public.checklist_templates set is_default = false where applies_to = 'general' and is_default;
alter table public.checklist_templates
  add constraint checklist_templates_general_not_default check (not (is_default and applies_to = 'general'));

create or replace function public.save_template(
  p_template uuid, p_name text, p_applies_to public.checklist_scope, p_is_default boolean, p_items text[]
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_items text[];
  v_id uuid;
begin
  perform app_private.require_active();
  if length(trim(coalesce(p_name, ''))) < 2 then
    perform app_private.fail('Enter the template name (at least 2 characters).');
  end if;
  v_items := app_private.clean_items(p_items);
  if coalesce(array_length(v_items, 1), 0) = 0 then
    perform app_private.fail('Add at least one item (one per line).');
  end if;
  if p_is_default and p_applies_to = 'general' then
    perform app_private.fail('General templates are not attached automatically, so they cannot be the default.');
  end if;
  if p_is_default then
    update public.checklist_templates set is_default = false
    where applies_to = p_applies_to and is_default and id is distinct from p_template;
  end if;
  if p_template is null then
    insert into public.checklist_templates (name, applies_to, is_default)
    values (trim(p_name), p_applies_to, coalesce(p_is_default, false))
    returning id into v_id;
  else
    update public.checklist_templates
    set name = trim(p_name), applies_to = p_applies_to, is_default = coalesce(p_is_default, false)
    where id = p_template
    returning id into v_id;
    if v_id is null then
      perform app_private.fail('Template not found.');
    end if;
    delete from public.template_items where template_id = v_id;
  end if;
  insert into public.template_items (template_id, position, text)
  select v_id, ord::int, x from unnest(v_items) with ordinality as t (x, ord);
  return v_id;
end $$;

-- The 200-item limit counts the items a checklist has, not their positions.
create or replace function public.add_checklist_items(p_checklist uuid, p_items text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_items text[];
  v_max int;
begin
  perform app_private.require_active();
  perform 1 from public.checklists where id = p_checklist for update;
  if not found then
    perform app_private.fail('Checklist not found.');
  end if;
  v_items := app_private.clean_items(p_items);
  if coalesce(array_length(v_items, 1), 0) = 0 then
    perform app_private.fail('Add at least one item (one per line).');
  end if;
  select coalesce(max(position), 0) into v_max from public.checklist_items where checklist_id = p_checklist;
  if (select count(*) from public.checklist_items where checklist_id = p_checklist) + array_length(v_items, 1) > 200 then
    perform app_private.fail('A checklist can have at most 200 items.');
  end if;
  perform app_private.insert_items(p_checklist, v_items, v_max);
end $$;

-- Ticking an already ticked item keeps the original who/when.
create or replace function public.toggle_checklist_item(p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  update public.checklist_items
  set done_by = case when p_done then coalesce(done_by, auth.uid()) end,
      done_at = case when p_done then coalesce(done_at, now()) end
  where id = p_item;
  if not found then
    perform app_private.fail('Item not found.');
  end if;
end $$;

-- Items are assigned to active organizers only (an existing inactive assignee may stay).
create function app_private.check_assignee() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and not exists (select 1 from public.profiles where user_id = new.assignee_id and active) then
    perform app_private.fail('Choose an active organizer to assign this to.');
  end if;
  return new;
end $fn$;
create trigger checklist_items_check_assignee before insert or update of assignee_id on public.checklist_items
  for each row execute function app_private.check_assignee();
