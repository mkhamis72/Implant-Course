-- Catalogue library (owner request C; spec docs/superpowers/specs/2026-11-21-catalogue-library-design.md).
--   * catalog_items: one global library of ready-made product catalogues (no company_id, like plans), read by
--     every signed-in user, written only by `npm run catalog:load` (postgres). Seeded from
--     docs/catalog/oxy-catalog.csv, the source 0026's catalogue was generated from.
--   * products.catalog_item_id: a company's product switched on from the library. Existing products are linked by
--     brand + type + ref code, so no company sees anything change. A linked product's catalogue fields are locked
--     (products_catalog_locked); its reorder level and Active stay editable.
--   * set_catalog_items / set_products_active: Admin → Catalogue switches products on or off (admin only).
--     Switching off only hides a product from the dropdowns for new choices.
--   * provision_company: a new company starts with no products; its admin switches them on.
--   * place_implant_v4: a switched-off implant can still be placed when it is the one planned, or a spare, for
--     that tooth.
set local lock_timeout = '5s';

-- ── catalog_items ────────────────────────────────────────────────────────────────────────────────────
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  type public.product_type not null,
  brand text not null check (length(trim(brand)) between 1 and 60),
  system text not null default '' check (length(system) <= 60),
  platform text not null default '' check (length(platform) <= 40),
  diameter_mm numeric(4, 2) check (diameter_mm between 2 and 9),
  length_mm numeric(4, 1) check (length_mm between 4 and 25),
  ref_code text not null default '' check (length(ref_code) <= 60),
  description text not null default '' check (length(description) <= 200),
  source text not null default '' check (length(source) <= 200),
  retired boolean not null default false,
  created_at timestamptz not null default now(),
  constraint catalog_items_key unique nulls not distinct (brand, ref_code, type, diameter_mm, length_mm)
);
alter table public.catalog_items enable row level security;
alter table public.catalog_items force row level security;
-- Read by every signed-in user and by the definers; no API writes (the loader runs as postgres).
create policy catalog_items_select on public.catalog_items for select to authenticated using (true);
create policy catalog_items_tenant_definer on public.catalog_items for select to tenant_definer using (true);
revoke all on public.catalog_items from public, anon, authenticated, tenant_definer;
grant select on public.catalog_items to authenticated, tenant_definer, service_role;

insert into public.catalog_items (type, brand, system, platform, diameter_mm, length_mm, ref_code, description, source)
select v.type::public.product_type, v.brand, v.system, v.platform, v.d, v.l, v.ref, v.descr, v.src
from (values
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium Narrow', 'Mini conical', 3, 10, 'OMKN30100', '', 'PSK-MDK p.11'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium Narrow', 'Mini conical', 3, 11.5, 'OMKN30115', '', 'PSK-MDK p.11'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium Narrow', 'Mini conical', 3, 13, 'OMKN30130', '', 'PSK-MDK p.11'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium Narrow', 'Mini conical', 3, 15, 'OMKN30150', '', 'PSK-MDK p.11'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro Narrow', 'Mini conical', 3, 10, 'PSKN30100', '', 'PSK-MDK p.11'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro Narrow', 'Mini conical', 3, 11.5, 'PSKN30115', '', 'PSK-MDK p.11'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro Narrow', 'Mini conical', 3, 13, 'PSKN30130', '', 'PSK-MDK p.11'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro Narrow', 'Mini conical', 3, 15, 'PSKN30150', '', 'PSK-MDK p.11'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 3.75, 8.5, 'OMKR37085', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 3.75, 10, 'OMKR37100', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 3.75, 11.5, 'OMKR37115', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 3.75, 13, 'OMKR37130', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 3.75, 15, 'OMKR37150', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 4.25, 7, 'OMKR42070', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 4.25, 8.5, 'OMKR42085', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 4.25, 10, 'OMKR42100', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 4.25, 11.5, 'OMKR42115', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 4.25, 13, 'OMKR42130', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 4.25, 15, 'OMKR42150', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 5, 7, 'OMKR50070', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 5, 8.5, 'OMKR50085', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 5, 10, 'OMKR50100', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 5, 11.5, 'OMKR50115', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · MDK Medium', 'Standard conical', 5, 13, 'OMKR50130', '', 'PSK-MDK p.13'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 3.5, 7, 'PSKR35070', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 3.5, 8.5, 'PSKR35085', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 3.5, 10, 'PSKR35100', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 3.5, 11.5, 'PSKR35115', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 3.5, 13, 'PSKR35130', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 3.5, 15, 'PSKR35150', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4, 7, 'PSKR40070', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4, 8.5, 'PSKR40085', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4, 10, 'PSKR40100', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4, 11.5, 'PSKR40115', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4, 13, 'PSKR40130', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4, 15, 'PSKR40150', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4.5, 7, 'PSKR45070', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4.5, 8.5, 'PSKR45085', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4.5, 10, 'PSKR45100', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4.5, 11.5, 'PSKR45115', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4.5, 13, 'PSKR45130', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 4.5, 15, 'PSKR45150', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 5, 7, 'PSKR50070', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 5, 8.5, 'PSKR50085', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 5, 10, 'PSKR50100', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 5, 11.5, 'PSKR50115', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 5, 13, 'PSKR50130', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Micro', 'Standard conical', 5, 15, 'PSKR50150', '', 'PSK-MDK p.15'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 3.5, 8.5, 'PSK35085NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 3.5, 10, 'PSK35100NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 3.5, 11.5, 'PSK35115NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 3.5, 13, 'PSK35130NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 3.5, 15, 'PSK35150NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4, 7, 'PSK40070NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4, 8.5, 'PSK40085NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4, 10, 'PSK40100NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4, 11.5, 'PSK40115NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4, 13, 'PSK40130NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4, 15, 'PSK40150NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4, 17, 'PSK40170NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4, 20, 'PSK40200NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4.5, 7, 'PSK45070NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4.5, 8.5, 'PSK45085NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4.5, 10, 'PSK45100NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4.5, 11.5, 'PSK45115NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4.5, 13, 'PSK45130NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4.5, 15, 'PSK45150NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4.5, 17, 'PSK45170NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 4.5, 20, 'PSK45200NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 5, 7, 'PSK50070NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 5, 8.5, 'PSK50085NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 5, 10, 'PSK50100NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 5, 11.5, 'PSK50115NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 5, 13, 'PSK50130NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'PSK-MDK · PSK Normo', 'Standard conical', 5, 15, 'PSK50150NT', '', 'PSK-MDK p.17'),
  ('implant', 'Oxy Implant', 'MD EXT · Mini', 'External hex 3.3', 3.3, 10, 'OMEX33100', '', 'MD EXT p.7'),
  ('implant', 'Oxy Implant', 'MD EXT · Mini', 'External hex 3.3', 3.3, 11.5, 'OMEX33115', '', 'MD EXT p.7'),
  ('implant', 'Oxy Implant', 'MD EXT · Mini', 'External hex 3.3', 3.3, 13, 'OMEX33130', '', 'MD EXT p.7'),
  ('implant', 'Oxy Implant', 'MD EXT · Standard', 'External hex 4.1', 3.75, 8.5, 'OMEX37085', '', 'MD EXT p.8'),
  ('implant', 'Oxy Implant', 'MD EXT · Standard', 'External hex 4.1', 3.75, 10, 'OMEX37100', '', 'MD EXT p.8'),
  ('implant', 'Oxy Implant', 'MD EXT · Standard', 'External hex 4.1', 3.75, 11.5, 'OMEX37115', '', 'MD EXT p.8'),
  ('implant', 'Oxy Implant', 'MD EXT · Standard', 'External hex 4.1', 3.75, 13, 'OMEX37130', '', 'MD EXT p.8'),
  ('implant', 'Oxy Implant', 'MD EXT · Standard', 'External hex 4.1', 3.75, 15, 'OMEX37150', '', 'MD EXT p.8'),
  ('implant', 'Oxy Implant', 'MD EXT · Standard', 'External hex 4.1', 4.25, 8.5, 'OMEX42085', '', 'MD EXT p.8'),
  ('implant', 'Oxy Implant', 'MD EXT · Standard', 'External hex 4.1', 4.25, 10, 'OMEX42100', '', 'MD EXT p.8'),
  ('implant', 'Oxy Implant', 'MD EXT · Standard', 'External hex 4.1', 4.25, 11.5, 'OMEX42115', '', 'MD EXT p.8'),
  ('implant', 'Oxy Implant', 'MD EXT · Standard', 'External hex 4.1', 4.25, 13, 'OMEX42130', '', 'MD EXT p.8'),
  ('implant', 'Oxy Implant', 'MD EXT · Standard', 'External hex 4.1', 4.25, 15, 'OMEX42150', '', 'MD EXT p.8'),
  ('implant', 'Oxy Implant', 'MD EXT · Maxi', 'External hex 5.0', 5, 8.5, 'OMEX50085', '', 'MD EXT p.9'),
  ('implant', 'Oxy Implant', 'MD EXT · Maxi', 'External hex 5.0', 5, 10, 'OMEX50100', '', 'MD EXT p.9'),
  ('implant', 'Oxy Implant', 'MD EXT · Maxi', 'External hex 5.0', 5, 11.5, 'OMEX50115', '', 'MD EXT p.9'),
  ('implant', 'Oxy Implant', 'MD EXT · Maxi', 'External hex 5.0', 5, 13, 'OMEX50130', '', 'MD EXT p.9'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1HAN4530', 'Healing abutment Ø4.5 · H 3.0 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1HAN4545', 'Healing abutment Ø4.5 · H 4.5 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1HAN4560', 'Healing abutment Ø4.5 · H 6.0 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1HAR4020', 'Healing abutment Ø4.0 · H 2.0 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1HAR4030', 'Healing abutment Ø4.0 · H 3.0 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1HAR4040', 'Healing abutment Ø4.0 · H 4.0 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1HAR5030', 'Healing abutment Ø5.0 · H 3.0 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1HAR5045', 'Healing abutment Ø5.0 · H 4.5 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1HAR5060', 'Healing abutment Ø5.0 · H 6.0 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1HAW6030', 'Healing abutment Ø6.0 · H 3.0 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1HAW6045', 'Healing abutment Ø6.0 · H 4.5 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1HAW6060', 'Healing abutment Ø6.0 · H 6.0 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1HAW7030', 'Healing abutment Ø7.0 · H 3.0 mm', 'PSK-MDK p.18'),
  ('healing_abutment', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1HAW8030', 'Healing abutment Ø8.0 · H 3.0 mm', 'PSK-MDK p.18'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1STNA10', 'Straight abutment Ø4.0 · GH 1.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1STNA20', 'Straight abutment Ø4.0 · GH 2.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1STNA30', 'Straight abutment Ø4.0 · GH 3.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1STNA40', 'Straight abutment Ø4.0 · GH 4.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1STRR4020', 'Straight abutment Ø4.0 · GH 2.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1STRR4030', 'Straight abutment Ø4.0 · GH 3.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1STRR4040', 'Straight abutment Ø4.0 · GH 4.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1STRR10', 'Straight abutment Ø4.5 · GH 1.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1STRR20', 'Straight abutment Ø4.5 · GH 2.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1STRR30', 'Straight abutment Ø4.5 · GH 3.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1STRR40', 'Straight abutment Ø4.5 · GH 4.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1STRW20', 'Straight abutment Ø5.5 · GH 2.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1STRW30', 'Straight abutment Ø5.5 · GH 3.0 mm', 'PSK-MDK p.20'),
  ('abutment_straight', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1STRW40', 'Straight abutment Ø5.5 · GH 4.0 mm', 'PSK-MDK p.20'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1ANN1510', 'Angled abutment 15° · GH 1.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1ANN1520', 'Angled abutment 15° · GH 2.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1ANN1530', 'Angled abutment 15° · GH 3.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1ANN1540', 'Angled abutment 15° · GH 4.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1ANN2510', 'Angled abutment 25° · GH 1.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1ANN2520', 'Angled abutment 25° · GH 2.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1ANN2530', 'Angled abutment 25° · GH 3.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1ANN2540', 'Angled abutment 25° · GH 4.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ANR1020', 'Angled abutment 10° · GH 2.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ANR1030', 'Angled abutment 10° · GH 3.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ANR1510', 'Angled abutment 15° · GH 1.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ANR1520', 'Angled abutment 15° · GH 2.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ANR1530', 'Angled abutment 15° · GH 3.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ANR1540', 'Angled abutment 15° · GH 4.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ANR2510', 'Angled abutment 25° · GH 1.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ANR2520', 'Angled abutment 25° · GH 2.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ANR2530', 'Angled abutment 25° · GH 3.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ANR2540', 'Angled abutment 25° · GH 4.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1ANW1520', 'Angled abutment 15° · GH 2.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1ANW1530', 'Angled abutment 15° · GH 3.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1ANW1540', 'Angled abutment 15° · GH 4.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1ANW2520', 'Angled abutment 25° · GH 2.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1ANW2530', 'Angled abutment 25° · GH 3.0 mm', 'PSK-MDK p.21–22'),
  ('abutment_angled', 'Oxy Implant', 'PSK-MDK', 'Standard conical (extra-wide)', null, null, 'K1ANW2540', 'Angled abutment 25° · GH 4.0 mm', 'PSK-MDK p.21–22'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1BTRN', 'Ti-base Flat · rotational', 'PSK-MDK p.25'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1BTNN', 'Ti-base Flat · antirotational', 'PSK-MDK p.25'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1BTRN20', 'Ti-base Flat · rotational · GH 2.0 mm', 'PSK-MDK p.25'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1BTNN20', 'Ti-base Flat · antirotational · GH 2.0 mm', 'PSK-MDK p.25'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1BTRR', 'Ti-base Flat · rotational', 'PSK-MDK p.25'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1BTNR', 'Ti-base Flat · antirotational', 'PSK-MDK p.25'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1BTRR20', 'Ti-base Flat · rotational · GH 2.0 mm', 'PSK-MDK p.25'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1BTNR20', 'Ti-base Flat · antirotational · GH 2.0 mm', 'PSK-MDK p.25'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1CBTRN', 'Ti-base Switch · rotational', 'PSK-MDK p.24'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1CBTNN', 'Ti-base Switch · antirotational', 'PSK-MDK p.24'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1CBTRN20', 'Ti-base Switch · rotational · GH 2.0 mm', 'PSK-MDK p.24'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Mini conical', null, null, 'K1CBTNN20', 'Ti-base Switch · antirotational · GH 2.0 mm', 'PSK-MDK p.24'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1CBTRR', 'Ti-base Switch · rotational', 'PSK-MDK p.24'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1CBTNR', 'Ti-base Switch · antirotational', 'PSK-MDK p.24'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1CBTRR20', 'Ti-base Switch · rotational · GH 2.0 mm', 'PSK-MDK p.24'),
  ('ti_base', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1CBTNR20', 'Ti-base Switch · antirotational · GH 2.0 mm', 'PSK-MDK p.24'),
  ('multi_unit', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ILR0010', 'ILS multi-unit straight · GH 1.0 mm', 'PSK-MDK p.34'),
  ('multi_unit', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ILR0020', 'ILS multi-unit straight · GH 2.0 mm', 'PSK-MDK p.34'),
  ('multi_unit', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ILR0030', 'ILS multi-unit straight · GH 3.0 mm', 'PSK-MDK p.34'),
  ('multi_unit', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ILR1720', 'ILS multi-unit angled 17° · GH 2.0 mm', 'PSK-MDK p.34'),
  ('multi_unit', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ILR1730', 'ILS multi-unit angled 17° · GH 3.0 mm', 'PSK-MDK p.34'),
  ('multi_unit', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ILR3530', 'ILS multi-unit angled 35° · GH 3.0 mm', 'PSK-MDK p.34'),
  ('multi_unit', 'Oxy Implant', 'PSK-MDK', 'Standard conical', null, null, 'K1ILR3540', 'ILS multi-unit angled 35° · GH 4.0 mm', 'PSK-MDK p.34'),
  ('healing_abutment', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'HAEX2015', 'Healing abutment Ø3.6 · H 1.5 mm', 'MD EXT p.12'),
  ('healing_abutment', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'HAEX2030', 'Healing abutment Ø3.6 · H 3.0 mm', 'MD EXT p.12'),
  ('healing_abutment', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'HAEX2050', 'Healing abutment Ø3.6 · H 5.0 mm', 'MD EXT p.12'),
  ('healing_abutment', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'HAEX3415', 'Healing abutment Ø4.1 · H 1.5 mm', 'MD EXT p.12'),
  ('healing_abutment', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'HAEX3430', 'Healing abutment Ø4.1 · H 3.0 mm', 'MD EXT p.12'),
  ('healing_abutment', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'HAEX3450', 'Healing abutment Ø4.1 · H 5.0 mm', 'MD EXT p.12'),
  ('healing_abutment', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'HAEX5015', 'Healing abutment Ø5.0 · H 1.5 mm', 'MD EXT p.12'),
  ('healing_abutment', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'HAEX5030', 'Healing abutment Ø5.0 · H 3.0 mm', 'MD EXT p.12'),
  ('healing_abutment', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'HAEX5050', 'Healing abutment Ø5.0 · H 5.0 mm', 'MD EXT p.12'),
  ('abutment_straight', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'STEX2015', 'Straight abutment Ø3.6 · GH 1.5 mm', 'MD EXT p.15'),
  ('abutment_straight', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'STEX2025', 'Straight abutment Ø3.6 · GH 2.5 mm', 'MD EXT p.15'),
  ('abutment_straight', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'STEX2035', 'Straight abutment Ø3.6 · GH 3.5 mm', 'MD EXT p.15'),
  ('abutment_straight', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'STEX3415', 'Straight abutment Ø4.1 · GH 1.5 mm', 'MD EXT p.15'),
  ('abutment_straight', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'STEX3425', 'Straight abutment Ø4.1 · GH 2.5 mm', 'MD EXT p.15'),
  ('abutment_straight', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'STEX3435', 'Straight abutment Ø4.1 · GH 3.5 mm', 'MD EXT p.15'),
  ('abutment_straight', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'STEX5015', 'Straight abutment Ø5.0 · GH 1.5 mm', 'MD EXT p.15'),
  ('abutment_straight', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'STEX5025', 'Straight abutment Ø5.0 · GH 2.5 mm', 'MD EXT p.15'),
  ('abutment_straight', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'STEX5035', 'Straight abutment Ø5.0 · GH 3.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'A1EX2015', 'Angled abutment 15° · GH 1.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'A2EX2015', 'Angled abutment 15° · GH 2.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'A3EX2015', 'Angled abutment 15° · GH 3.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'A1EX3415', 'Angled abutment 15° · GH 1.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'A2EX3415', 'Angled abutment 15° · GH 2.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'A3EX3415', 'Angled abutment 15° · GH 3.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'A1EX5015', 'Angled abutment 15° · GH 1.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'A2EX5015', 'Angled abutment 15° · GH 2.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'A3EX5015', 'Angled abutment 15° · GH 3.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'A1EX2025', 'Angled abutment 25° · GH 1.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'A2EX2025', 'Angled abutment 25° · GH 2.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'A3EX2025', 'Angled abutment 25° · GH 3.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'A1EX3425', 'Angled abutment 25° · GH 1.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'A2EX3425', 'Angled abutment 25° · GH 2.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'A3EX3425', 'Angled abutment 25° · GH 3.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'A1EX5025', 'Angled abutment 25° · GH 1.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'A2EX5025', 'Angled abutment 25° · GH 2.5 mm', 'MD EXT p.15'),
  ('abutment_angled', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'A3EX5025', 'Angled abutment 25° · GH 3.5 mm', 'MD EXT p.15'),
  ('ti_base', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'BTER20', 'Ti-base for CAD-CAM · rotational', 'MD EXT p.20'),
  ('ti_base', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'BTER2020', 'Ti-base for CAD-CAM · rotational · GH 2.0 mm', 'MD EXT p.20'),
  ('ti_base', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'BTER34', 'Ti-base for CAD-CAM · rotational', 'MD EXT p.20'),
  ('ti_base', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'BTER3420', 'Ti-base for CAD-CAM · rotational · GH 2.0 mm', 'MD EXT p.20'),
  ('ti_base', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'BTER50', 'Ti-base for CAD-CAM · rotational', 'MD EXT p.20'),
  ('ti_base', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'BTEN20', 'Ti-base for CAD-CAM · antirotational', 'MD EXT p.20'),
  ('ti_base', 'Oxy Implant', 'MD EXT', 'External hex 3.3 (mini)', null, null, 'BTEN2020', 'Ti-base for CAD-CAM · antirotational · GH 2.0 mm', 'MD EXT p.20'),
  ('ti_base', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'BTEN34', 'Ti-base for CAD-CAM · antirotational', 'MD EXT p.20'),
  ('ti_base', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'BTEN3420', 'Ti-base for CAD-CAM · antirotational · GH 2.0 mm', 'MD EXT p.20'),
  ('ti_base', 'Oxy Implant', 'MD EXT', 'External hex 5.0 (maxi)', null, null, 'BTEN50', 'Ti-base for CAD-CAM · antirotational', 'MD EXT p.20'),
  ('multi_unit', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'ILAE003410', 'ILS multi-unit straight · GH 1.0 mm', 'MD EXT p.18'),
  ('multi_unit', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'ILAE003420', 'ILS multi-unit straight · GH 2.0 mm', 'MD EXT p.18'),
  ('multi_unit', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'ILAE003430', 'ILS multi-unit straight · GH 3.0 mm', 'MD EXT p.18'),
  ('multi_unit', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'ILAE173420', 'ILS multi-unit angled 17° · GH 2.0 mm', 'MD EXT p.18'),
  ('multi_unit', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'ILAE173430', 'ILS multi-unit angled 17° · GH 3.0 mm', 'MD EXT p.18'),
  ('multi_unit', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'ILAE353430', 'ILS multi-unit angled 35° · GH 3.0 mm', 'MD EXT p.18'),
  ('multi_unit', 'Oxy Implant', 'MD EXT', 'External hex 4.1 (standard)', null, null, 'ILAE353440', 'ILS multi-unit angled 35° · GH 4.0 mm', 'MD EXT p.18')
) as v(type, brand, system, platform, d, l, ref, descr, src);

-- ── products.catalog_item_id ─────────────────────────────────────────────────────────────────────────
-- Not granted to authenticated (0008's column grants stay): only the definers link a product.
alter table public.products add column catalog_item_id uuid references public.catalog_items (id);
create unique index products_company_catalog_item_key on public.products (company_id, catalog_item_id)
  where catalog_item_id is not null;
create index products_catalog_item_id_idx on public.products (catalog_item_id);

-- Link every company's existing products: brand + type + ref code (all fields when the item has no ref code),
-- the oldest matching product per company and item.
update public.products p set catalog_item_id = m.item_id
from (
  select distinct on (p2.company_id, i.id) p2.id as product_id, i.id as item_id
  from public.products p2
  join public.catalog_items i
    on i.brand = p2.brand and i.type = p2.type
   and ((i.ref_code <> '' and p2.ref_code = i.ref_code)
     or (i.ref_code = '' and (p2.system, p2.platform, p2.diameter_mm, p2.length_mm, p2.ref_code)
           is not distinct from (i.system, i.platform, i.diameter_mm, i.length_mm, i.ref_code)))
  where p2.catalog_item_id is null and not p2.is_sample
  order by p2.company_id, i.id, p2.created_at, p2.id
) m
where p.id = m.product_id;

-- ── Linked products keep the library's fields ────────────────────────────────────────────────────────
create function app_private.protect_catalog_product() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.catalog_item_id is not null
     and (new.type, new.brand, new.system, new.platform, new.diameter_mm, new.length_mm, new.ref_code, new.description)
       is distinct from
         (old.type, old.brand, old.system, old.platform, old.diameter_mm, old.length_mm, old.ref_code, old.description) then
    perform app_private.fail('This product comes from the catalogue library, so only its reorder level and Active can change.');
  end if;
  return new;
end $$;
revoke all on function app_private.protect_catalog_product() from public;

create trigger products_catalog_locked before update on public.products
  for each row execute function app_private.protect_catalog_product();

-- ── provision_company: 0095's body without the copied catalogue ──────────────────────────────────────
create or replace function public.provision_company(p_slug text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_slug text := trim(coalesce(p_slug, ''));
  v_name text := trim(coalesce(p_name, ''));
  v_academy constant uuid := 'a7c0de00-0000-4000-8000-000000000001';
  v_id uuid;
begin
  if v_slug !~ '^[a-z0-9-]{2,40}$' then
    perform app_private.fail('Use a slug of 2–40 lower-case letters, digits or hyphens.');
  end if;
  if length(v_name) < 2 then
    perform app_private.fail('The company needs a name.');
  end if;
  insert into public.companies (slug, name) values (v_slug, v_name)
  on conflict (slug) do nothing
  returning id into v_id;
  if v_id is null then
    -- A retried registration (the registry never saved the id): a company nobody belongs to yet is that
    -- earlier call's, seeded in its transaction, so hand back its id. One with members is someone else's.
    select c.id into v_id from public.companies c where c.slug = v_slug for update;
    if exists (select 1 from public.company_members m where m.company_id = v_id) then
      perform app_private.fail('A company with this slug already exists.');
    end if;
    return v_id;
  end if;

  insert into public.settings (company_id) values (v_id);
  -- Branding names are 2–60 characters (0040); the company keeps its full name.
  insert into public.branding (company_id, name) values (v_id, left(v_name, 60));
  insert into app_private.file_no_counters (company_id, last_no) values (v_id, 0);

  -- In academy's order: created_at defaults to clock_timestamp(), evaluated per row, so the copies keep it.
  insert into public.consent_form_versions (company_id, label, effective_on, text_en, text_ar)
  select v_id, v.label, v.effective_on, v.text_en, v.text_ar
  from public.consent_form_versions v
  where v.company_id = v_academy
  order by v.created_at, v.id;

  return v_id;
end $$;

alter function public.provision_company(text, text) owner to postgres;
-- 0092's default privileges give tenant_definer execute on every new postgres-owned function: take it back.
revoke all on function public.provision_company(text, text) from public, anon, authenticated, tenant_definer;
grant execute on function public.provision_company(text, text) to service_role;

-- ── set_catalog_items: Admin → Catalogue switches library items on or off for the admin's company ───────
-- On: the linked product becomes active; else an unlinked product with the same brand, type and ref code is linked
-- (so no near-duplicate appears); else a product is copied from the item. Off: the linked product becomes
-- inactive (never deleted: planned, placed and stocked records keep it). Returns the number of products changed.
create function public.set_catalog_items(p_item_ids uuid[], p_on boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_item public.catalog_items;
  v_product uuid;
  v_changed int := 0;
  v_count int;
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if p_on is null then
    perform app_private.fail('Choose on or off.');
  end if;
  if exists (select 1 from unnest(coalesce(p_item_ids, '{}')) x(id)
             where not exists (select 1 from public.catalog_items i where i.id = x.id)) then
    perform app_private.fail('Product not found.');
  end if;

  for v_item in select * from public.catalog_items where id = any (p_item_ids) order by id loop
    if not p_on then
      update public.products set active = false
      where company_id = v_company and catalog_item_id = v_item.id and active;
      get diagnostics v_count = row_count;
      v_changed := v_changed + v_count;
      continue;
    end if;

    if v_item.retired then
      perform app_private.fail('This product is no longer in the catalogue.');
    end if;
    select id into v_product from public.products
    where company_id = v_company and catalog_item_id = v_item.id for update;
    if found then
      update public.products set active = true where id = v_product and not active;
      get diagnostics v_count = row_count;
      v_changed := v_changed + v_count;
      continue;
    end if;

    select id into v_product from public.products
    where company_id = v_company and catalog_item_id is null and v_item.ref_code <> ''
      and brand = v_item.brand and type = v_item.type and ref_code = v_item.ref_code
    order by created_at, id limit 1 for update;
    if found then
      update public.products set catalog_item_id = v_item.id, active = true where id = v_product;
    else
      insert into public.products (company_id, type, brand, system, platform, diameter_mm, length_mm, ref_code,
        description, reorder_level, active, catalog_item_id)
      values (v_company, v_item.type, v_item.brand, v_item.system, v_item.platform, v_item.diameter_mm,
        v_item.length_mm, v_item.ref_code, v_item.description, 0, true, v_item.id);
    end if;
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;

-- ── set_products_active: the same for the company's own (hand-entered) products ──────────────────────
create function public.set_products_active(p_product_ids uuid[], p_on boolean) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_count int;
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if p_on is null then
    perform app_private.fail('Choose on or off.');
  end if;
  update public.products set active = p_on
  where company_id = v_company and id = any (coalesce(p_product_ids, '{}')) and active is distinct from p_on;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it), as in 0126.
grant create on schema public, app_private to tenant_definer;
alter function public.set_catalog_items(uuid[], boolean) owner to tenant_definer;
alter function public.set_products_active(uuid[], boolean) owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;

revoke execute on function public.set_catalog_items(uuid[], boolean), public.set_products_active(uuid[], boolean)
  from public, anon;
grant execute on function public.set_catalog_items(uuid[], boolean), public.set_products_active(uuid[], boolean)
  to authenticated;
