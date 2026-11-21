-- Catalogue library, part 3 (final-review fix). receive_stock, same signature (0030's body), so its owner and grants
-- stay: stock can still be received for an implant switched off in Admin → Catalogue (0128) while it is planned on a
-- booking (a planned site) or one of a live booking's spares, so a planned implant with no stock can still be placed
-- with Inventory on (0129). Any other inactive product is still refused.
set local lock_timeout = '5s';

create or replace function public.receive_stock(
  p_product uuid, p_qty int, p_lot_no text default null, p_expiry date default null,
  p_received_on date default null, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_lot uuid;
begin
  perform app_private.require_perm('inventory', 'edit');
  if not exists (select 1 from public.products where id = p_product and active)
     and not exists (select 1 from public.implant_sites s where s.product_id = p_product and s.state = 'planned')
     and not exists (select 1 from public.slot_spare_implants sp
                     join public.surgery_slots sl on sl.id = sp.slot_id
                     where sp.product_id = p_product and sl.status <> 'cancelled') then
    perform app_private.fail('Choose an active product from the catalog.');
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    perform app_private.fail('Enter a quantity between 1 and 100000.');
  end if;
  if coalesce(p_received_on, public.cairo_today()) > public.cairo_today() then
    perform app_private.fail('The received date cannot be in the future.');
  end if;
  insert into public.stock_lots (product_id, lot_no, expiry, received_on, qty_received, notes)
  values (p_product, nullif(trim(p_lot_no), ''), p_expiry, coalesce(p_received_on, public.cairo_today()), p_qty, coalesce(p_notes, ''))
  returning id into v_lot;
  insert into public.stock_movements (stock_lot_id, delta, reason) values (v_lot, p_qty, 'receive');
  return v_lot;
end $$;
