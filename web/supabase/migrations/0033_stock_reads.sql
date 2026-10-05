-- Stock on hand (the sum of movements) is needed to place implants (Patients) and for the
-- surgery-day pull list (Schedule), not only on the Inventory panel. Reads only.
alter policy stock_movements_area_read on public.stock_movements
  using (public.can('inventory', 'view') or public.can('patients', 'view') or public.can('schedule', 'view'));
