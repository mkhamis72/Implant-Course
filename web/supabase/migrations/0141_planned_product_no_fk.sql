-- Implant types, release fix: no foreign key on implant_sites.planned_product_id for now.
-- 0139 gave implant_sites a second foreign key to products (implant_sites_planned_product_id_fkey). PostgREST
-- then finds two relationships between the tables, and the previous app version's unhinted `products(*)` embeds
-- from implant_sites (patient chart, Implants table, booking edit) fail as ambiguous during the release, between
-- migrating production and the new code going live. The column and its index stay; the app reads planned products
-- with a query of its own. The key (company_id, planned_product_id) -> products (company_id, id) will be added back
-- in a later release, once no deployed app version embeds products from implant_sites without naming the key.
-- planned_product_id is written only by place_implant_v4, from the site's own (company-checked) product_id.
set local lock_timeout = '5s';

alter table public.implant_sites drop constraint implant_sites_planned_product_id_fkey;
