-- Helpers for SECURITY DEFINER business functions -------------------------------------------
create function app_private.fail(msg text) returns void
language plpgsql as $$
begin
  raise exception using message = msg, hint = 'user', errcode = 'P0001';
end $$;

create function app_private.require_active() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_active_user() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
end $$;

-- Stock batches and the ledger ---------------------------------------------------------------
create type public.movement_reason as enum ('receive', 'use', 'adjust', 'waste', 'return');

create table public.stock_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  lot_no text check (lot_no is null or length(trim(lot_no)) between 1 and 60),
  expiry date,
  received_on date not null default current_date,
  qty_received int not null check (qty_received between 1 and 100000),
  notes text not null default '' check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id)
);
create index stock_lots_product_idx on public.stock_lots (product_id);
create index stock_lots_lot_no_idx on public.stock_lots (upper(lot_no));

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  stock_lot_id uuid not null references public.stock_lots (id),
  delta int not null check (delta <> 0),
  reason public.movement_reason not null,
  implant_site_id uuid,
  site_component_id uuid,
  patient_id uuid references public.patients (id),
  note text not null default '' check (length(note) <= 500),
  reverses_movement_id uuid references public.stock_movements (id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.profiles (user_id)
);
create index stock_movements_lot_idx on public.stock_movements (stock_lot_id);
create index stock_movements_patient_idx on public.stock_movements (patient_id);

create function app_private.ledger_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'stock_movements is append-only';
end $$;

create trigger stock_movements_no_change before update or delete on public.stock_movements
  for each row execute function app_private.ledger_immutable();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function app_private.ledger_immutable();

create trigger stock_lots_audit after insert or update or delete on public.stock_lots
  for each row execute function app_private.audit_row('id');

revoke all on public.stock_lots, public.stock_movements from anon;
revoke insert, update, delete, truncate on public.stock_lots, public.stock_movements from authenticated;

alter table public.stock_lots enable row level security;
alter table public.stock_movements enable row level security;
create policy stock_lots_select on public.stock_lots for select to authenticated using (public.is_active_user());
create policy stock_movements_select on public.stock_movements for select to authenticated using (public.is_active_user());

create view public.stock_on_hand with (security_invoker = true) as
  select l.id as stock_lot_id, l.product_id, l.lot_no, l.expiry, l.received_on, l.qty_received,
         coalesce(sum(m.delta), 0)::int as on_hand
  from public.stock_lots l
  left join public.stock_movements m on m.stock_lot_id = l.id
  group by l.id;

create function app_private.lot_on_hand(p_lot uuid) returns int
language sql stable set search_path = '' as $$
  select coalesce(sum(delta), 0)::int from public.stock_movements where stock_lot_id = p_lot;
$$;

-- Business functions ---------------------------------------------------------------------------
create function public.receive_stock(
  p_product uuid, p_qty int, p_lot_no text default null, p_expiry date default null,
  p_received_on date default null, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_lot uuid;
begin
  perform app_private.require_active();
  if not exists (select 1 from public.products where id = p_product and active) then
    perform app_private.fail('Choose an active product from the catalog.');
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    perform app_private.fail('Enter a quantity between 1 and 100000.');
  end if;
  if coalesce(p_received_on, current_date) > current_date + 1 then
    perform app_private.fail('The received date cannot be in the future.');
  end if;
  insert into public.stock_lots (product_id, lot_no, expiry, received_on, qty_received, notes)
  values (p_product, nullif(trim(p_lot_no), ''), p_expiry, coalesce(p_received_on, current_date), p_qty, coalesce(p_notes, ''))
  returning id into v_lot;
  insert into public.stock_movements (stock_lot_id, delta, reason) values (v_lot, p_qty, 'receive');
  return v_lot;
end $$;

create function public.adjust_stock(p_lot uuid, p_delta int, p_reason public.movement_reason, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_on_hand int;
  v_id uuid;
begin
  perform app_private.require_active();
  if p_reason not in ('adjust', 'waste', 'return') then
    perform app_private.fail('Choose adjust, waste or return.');
  end if;
  if p_delta is null or p_delta = 0 then
    perform app_private.fail('Enter a quantity other than zero.');
  end if;
  if p_reason in ('waste', 'return') and p_delta > 0 then
    perform app_private.fail('Waste and returns take stock out: the quantity must be negative.');
  end if;
  if length(trim(coalesce(p_note, ''))) < 3 then
    perform app_private.fail('Explain the change (at least 3 characters).');
  end if;
  perform 1 from public.stock_lots where id = p_lot for update;
  if not found then
    perform app_private.fail('Stock batch not found.');
  end if;
  v_on_hand := app_private.lot_on_hand(p_lot);
  if v_on_hand + p_delta < 0 then
    perform app_private.fail(format('Only %s left in this batch.', v_on_hand));
  end if;
  insert into public.stock_movements (stock_lot_id, delta, reason, note)
  values (p_lot, p_delta, p_reason, trim(p_note))
  returning id into v_id;
  return v_id;
end $$;

create function public.inventory_overview(q text default '', p_category text default '', include_all boolean default false)
returns table (
  id uuid, type public.product_type, category text, brand text, system text, platform text,
  diameter_mm numeric, length_mm numeric, ref_code text, description text, reorder_level int,
  active boolean, is_sample boolean, on_hand int, nearest_expiry date
)
language sql stable security invoker set search_path = '' as $$
  with term as (
    select replace(replace(replace(coalesce(trim(q), ''), '\', '\\'), '%', '\%'), '_', '\_') as pat
  ),
  stock as (
    select s.product_id, sum(s.on_hand)::int as on_hand, min(s.expiry) filter (where s.on_hand > 0) as nearest_expiry
    from public.stock_on_hand s group by s.product_id
  )
  select p.id, p.type, p.category, p.brand, p.system, p.platform, p.diameter_mm, p.length_mm,
         p.ref_code, p.description, p.reorder_level, p.active, p.is_sample,
         coalesce(st.on_hand, 0), st.nearest_expiry
  from public.products p
  cross join term t
  left join stock st on st.product_id = p.id
  where (include_all or (p.active and (coalesce(st.on_hand, 0) > 0 or p.reorder_level > 0)))
    and (coalesce(p_category, '') = '' or p.category = p_category)
    and (t.pat = ''
         or (p.brand || ' ' || p.system || ' ' || p.platform || ' ' || p.description || ' ' || p.ref_code)
            ilike '%' || t.pat || '%' escape '\')
  order by p.brand, p.system, p.type, p.diameter_mm nulls first, p.length_mm nulls first, p.description;
$$;

create function public.search_lots(q text)
returns table (
  stock_lot_id uuid, lot_no text, expiry date, received_on date, on_hand int,
  product_id uuid, type public.product_type, brand text, system text, platform text,
  diameter_mm numeric, length_mm numeric, description text
)
language sql stable security invoker set search_path = '' as $$
  select s.stock_lot_id, s.lot_no, s.expiry, s.received_on, s.on_hand,
         p.id, p.type, p.brand, p.system, p.platform, p.diameter_mm, p.length_mm, p.description
  from public.stock_on_hand s
  join public.products p on p.id = s.product_id
  where length(trim(coalesce(q, ''))) > 0
    and s.lot_no ilike '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
  order by s.received_on desc
  limit 100;
$$;

revoke execute on function public.receive_stock(uuid, int, text, date, date, text) from public, anon;
revoke execute on function public.adjust_stock(uuid, int, public.movement_reason, text) from public, anon;
revoke execute on function public.inventory_overview(text, text, boolean) from public, anon;
revoke execute on function public.search_lots(text) from public, anon;
grant execute on function public.receive_stock(uuid, int, text, date, date, text) to authenticated;
grant execute on function public.adjust_stock(uuid, int, public.movement_reason, text) to authenticated;
grant execute on function public.inventory_overview(text, text, boolean) to authenticated;
grant execute on function public.search_lots(text) to authenticated;
