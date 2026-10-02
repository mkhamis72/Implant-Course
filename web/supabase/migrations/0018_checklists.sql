create type public.checklist_scope as enum ('general', 'lecture', 'workshop', 'surgery', 'surgery_booking');

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  applies_to public.checklist_scope not null default 'general',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now()
);
create unique index checklist_templates_one_default on public.checklist_templates (applies_to) where is_default;

create table public.template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates (id) on delete cascade,
  position int not null,
  text text not null check (length(trim(text)) between 1 and 300),
  unique (template_id, position)
);

create table public.checklists (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 120),
  template_id uuid references public.checklist_templates (id) on delete set null,
  session_id uuid references public.sessions (id) on delete cascade,
  slot_id uuid references public.surgery_slots (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id),
  updated_at timestamptz not null default now(),
  constraint checklists_one_owner check (num_nonnulls(session_id, slot_id) <= 1)
);
create index checklists_session_idx on public.checklists (session_id);
create index checklists_slot_idx on public.checklists (slot_id);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.checklists (id) on delete cascade,
  position int not null,
  text text not null check (length(trim(text)) between 1 and 300),
  assignee_id uuid references public.profiles (user_id),
  due_date date,
  done_by uuid references public.profiles (user_id),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  constraint checklist_items_position unique (checklist_id, position) deferrable initially deferred,
  constraint checklist_items_done_pair check ((done_by is null) = (done_at is null))
);
create index checklist_items_assignee_idx on public.checklist_items (assignee_id) where done_at is null;

create trigger checklist_templates_set_updated_at before update on public.checklist_templates for each row execute function app_private.set_updated_at();
create trigger checklists_set_updated_at before update on public.checklists for each row execute function app_private.set_updated_at();
create trigger checklist_templates_audit after insert or update or delete on public.checklist_templates for each row execute function app_private.audit_row('id');
create trigger template_items_audit after insert or update or delete on public.template_items for each row execute function app_private.audit_row('id');
create trigger checklists_audit after insert or update or delete on public.checklists for each row execute function app_private.audit_row('id');
create trigger checklist_items_audit after insert or update or delete on public.checklist_items for each row execute function app_private.audit_row('id');

revoke all on public.checklist_templates, public.template_items, public.checklists, public.checklist_items from anon;
revoke insert, update, delete, truncate on public.checklist_templates, public.template_items, public.checklists, public.checklist_items from authenticated;
grant delete on public.checklist_templates to authenticated;
grant update (title) on public.checklists to authenticated;
grant update (text, assignee_id, due_date) on public.checklist_items to authenticated;
grant delete on public.checklist_items to authenticated;

alter table public.checklist_templates enable row level security;
alter table public.template_items enable row level security;
alter table public.checklists enable row level security;
alter table public.checklist_items enable row level security;
create policy checklist_templates_select on public.checklist_templates for select to authenticated using (public.is_active_user());
create policy checklist_templates_delete on public.checklist_templates for delete to authenticated using (public.is_active_user());
create policy template_items_select on public.template_items for select to authenticated using (public.is_active_user());
create policy checklists_select on public.checklists for select to authenticated using (public.is_active_user());
create policy checklists_update on public.checklists for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy checklist_items_select on public.checklist_items for select to authenticated using (public.is_active_user());
create policy checklist_items_update on public.checklist_items for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
create policy checklist_items_delete on public.checklist_items for delete to authenticated using (public.is_active_user());

-- Trimmed, non-empty lines with limits (the UI also parses bullets; this is the safety net).
create function app_private.clean_items(p_items text[]) returns text[]
language plpgsql stable set search_path = '' as $$
declare
  v text[];
begin
  select coalesce(array_agg(trim(x) order by ord), '{}')
  into v
  from unnest(coalesce(p_items, '{}')) with ordinality as t (x, ord)
  where length(trim(coalesce(x, ''))) > 0;
  if coalesce(array_length(v, 1), 0) > 200 then
    perform app_private.fail('A checklist can have at most 200 items.');
  end if;
  if exists (select 1 from unnest(v) x where length(x) > 300) then
    perform app_private.fail('Each item can be at most 300 characters.');
  end if;
  return v;
end $$;

create function app_private.insert_items(p_checklist uuid, p_items text[], p_after int) returns void
language sql security definer set search_path = '' as $$
  insert into public.checklist_items (checklist_id, position, text)
  select p_checklist, p_after + ord::int, x
  from unnest(p_items) with ordinality as t (x, ord);
$$;

create function public.save_template(
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

create function public.create_checklist(
  p_title text, p_items text[] default '{}', p_template uuid default null,
  p_session uuid default null, p_slot uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_items text[];
  v_id uuid;
begin
  perform app_private.require_active();
  if length(trim(coalesce(p_title, ''))) < 2 then
    perform app_private.fail('Enter the checklist title (at least 2 characters).');
  end if;
  if p_session is not null and p_slot is not null then
    perform app_private.fail('A checklist belongs to either a session or a surgery booking, not both.');
  end if;
  if p_template is not null and not exists (select 1 from public.checklist_templates where id = p_template) then
    perform app_private.fail('Template not found.');
  end if;
  v_items := app_private.clean_items(
    coalesce((select array_agg(text order by position) from public.template_items where template_id = p_template), '{}')
    || coalesce(p_items, '{}')
  );
  if coalesce(array_length(v_items, 1), 0) = 0 then
    perform app_private.fail('Add at least one item (one per line).');
  end if;
  insert into public.checklists (title, template_id, session_id, slot_id)
  values (trim(p_title), p_template, p_session, p_slot)
  returning id into v_id;
  perform app_private.insert_items(v_id, v_items, 0);
  return v_id;
end $$;

create function public.add_checklist_items(p_checklist uuid, p_items text[]) returns void
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
  if v_max + array_length(v_items, 1) > 200 then
    perform app_private.fail('A checklist can have at most 200 items.');
  end if;
  perform app_private.insert_items(p_checklist, v_items, v_max);
end $$;

create function public.toggle_checklist_item(p_item uuid, p_done boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.require_active();
  update public.checklist_items
  set done_by = case when p_done then auth.uid() end,
      done_at = case when p_done then now() end
  where id = p_item;
  if not found then
    perform app_private.fail('Item not found.');
  end if;
end $$;

create function public.move_checklist_item(p_item uuid, p_direction int) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_item public.checklist_items;
  v_other public.checklist_items;
begin
  perform app_private.require_active();
  select * into v_item from public.checklist_items where id = p_item;
  if not found then
    perform app_private.fail('Item not found.');
  end if;
  perform 1 from public.checklists where id = v_item.checklist_id for update;
  if p_direction < 0 then
    select * into v_other from public.checklist_items
    where checklist_id = v_item.checklist_id and position < v_item.position order by position desc limit 1;
  else
    select * into v_other from public.checklist_items
    where checklist_id = v_item.checklist_id and position > v_item.position order by position asc limit 1;
  end if;
  if v_other.id is null then
    return;
  end if;
  update public.checklist_items set position = v_other.position where id = v_item.id;
  update public.checklist_items set position = v_item.position where id = v_other.id;
end $$;

-- Auto-attach the default template for a scope (no-op when there is none).
create function app_private.attach_default(p_scope public.checklist_scope, p_title text, p_session uuid, p_slot uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_template uuid;
  v_id uuid;
begin
  select id into v_template from public.checklist_templates where applies_to = p_scope and is_default;
  if v_template is null then
    return;
  end if;
  insert into public.checklists (title, template_id, session_id, slot_id)
  values (left(p_title, 120), v_template, p_session, p_slot)
  returning id into v_id;
  perform app_private.insert_items(
    v_id, (select array_agg(text order by position) from public.template_items where template_id = v_template), 0
  );
end $$;

create function app_private.session_checklist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.attach_default(new.type::text::public.checklist_scope, new.title || ' — checklist', new.id, null);
  return new;
end $$;

create function app_private.slot_checklist() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app_private.attach_default(
    'surgery_booking',
    'Surgery checklist — ' || coalesce((select full_name from public.patients where id = new.patient_id), 'patient'),
    null, new.id
  );
  return new;
end $$;

create trigger sessions_attach_checklist after insert on public.sessions
  for each row execute function app_private.session_checklist();
create trigger surgery_slots_attach_checklist after insert on public.surgery_slots
  for each row execute function app_private.slot_checklist();

revoke execute on function public.save_template(uuid, text, public.checklist_scope, boolean, text[]) from public, anon;
revoke execute on function public.create_checklist(text, text[], uuid, uuid, uuid) from public, anon;
revoke execute on function public.add_checklist_items(uuid, text[]) from public, anon;
revoke execute on function public.toggle_checklist_item(uuid, boolean) from public, anon;
revoke execute on function public.move_checklist_item(uuid, int) from public, anon;
grant execute on function public.save_template(uuid, text, public.checklist_scope, boolean, text[]) to authenticated;
grant execute on function public.create_checklist(text, text[], uuid, uuid, uuid) to authenticated;
grant execute on function public.add_checklist_items(uuid, text[]) to authenticated;
grant execute on function public.toggle_checklist_item(uuid, boolean) to authenticated;
grant execute on function public.move_checklist_item(uuid, int) to authenticated;
