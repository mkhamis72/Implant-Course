create type public.product_type as enum (
  'implant', 'cover_screw', 'healing_abutment', 'graft', 'membrane',
  'ti_base', 'multi_unit', 'abutment_straight', 'abutment_angled', 'scan_body',
  'impression_coping', 'analog', 'prosthetic_screw', 'other'
);

create function public.product_category(t public.product_type) returns text
language sql immutable as $$
  select case when t in ('implant', 'cover_screw', 'healing_abutment', 'graft', 'membrane')
              then 'surgical' else 'prosthetic' end;
$$;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  type public.product_type not null,
  category text generated always as (public.product_category(type)) stored,
  brand text not null check (length(trim(brand)) between 1 and 60),
  system text not null default '' check (length(system) <= 60),
  platform text not null default '' check (length(platform) <= 40),
  diameter_mm numeric(4, 2) check (diameter_mm between 2 and 9),
  length_mm numeric(4, 1) check (length_mm between 4 and 25),
  ref_code text not null default '' check (length(ref_code) <= 60),
  description text not null default '' check (length(description) <= 200),
  reorder_level int not null default 0 check (reorder_level between 0 and 10000),
  active boolean not null default true,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint products_implant_size check (type <> 'implant' or (diameter_mm is not null and length_mm is not null))
);
create index products_brand_idx on public.products (brand, system);

create trigger products_set_updated_at before update on public.products
  for each row execute function app_private.set_updated_at();
create trigger products_audit after insert or update or delete on public.products
  for each row execute function app_private.audit_row('id');

revoke all on public.products from anon;
revoke insert, update, delete, truncate on public.products from authenticated;
grant insert (type, brand, system, platform, diameter_mm, length_mm, ref_code, description, reorder_level, active)
  on public.products to authenticated;
grant update (type, brand, system, platform, diameter_mm, length_mm, ref_code, description, reorder_level, active, is_sample)
  on public.products to authenticated;

alter table public.products enable row level security;
create policy products_select on public.products for select to authenticated using (public.is_active_user());
create policy products_insert on public.products for insert to authenticated with check (public.is_active_user());
create policy products_update on public.products for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

-- Sample catalog (user decision). Reference codes are left empty: verify with the supplier.
with systems (brand, system, diameters, lengths) as (
  values
    ('Straumann', 'BLX', array[3.75, 4.0, 4.5, 5.0]::numeric[], array[8, 10, 12]::numeric[]),
    ('Straumann', 'BLT', array[3.3, 4.1, 4.8]::numeric[], array[8, 10, 12, 14]::numeric[]),
    ('Nobel Biocare', 'NobelActive', array[3.5, 4.3, 5.0]::numeric[], array[8.5, 10, 11.5, 13]::numeric[]),
    ('Neodent', 'Helix GM', array[3.5, 3.75, 4.0, 4.3, 5.0]::numeric[], array[8, 10, 11.5, 13]::numeric[]),
    ('MIS', 'C1', array[3.75, 4.2, 5.0]::numeric[], array[8, 10, 11.5, 13]::numeric[]),
    ('Osstem', 'TSIII', array[3.5, 4.0, 4.5, 5.0]::numeric[], array[8.5, 10, 11.5, 13]::numeric[])
)
insert into public.products (type, brand, system, diameter_mm, length_mm, is_sample)
select 'implant', s.brand, s.system, d, l, true
from systems s cross join lateral unnest(s.diameters) d cross join lateral unnest(s.lengths) l;

insert into public.products (type, brand, system, description, is_sample)
select c.type::public.product_type, s.brand, s.system, c.description, true
from (values ('Straumann', 'BLX'), ('Straumann', 'BLT'), ('Nobel Biocare', 'NobelActive'),
             ('Neodent', 'Helix GM'), ('MIS', 'C1'), ('Osstem', 'TSIII')) as s (brand, system)
cross join (values
  ('cover_screw', 'Cover screw'),
  ('healing_abutment', 'Healing abutment 3.5 mm'),
  ('healing_abutment', 'Healing abutment 5 mm'),
  ('ti_base', 'Ti-base'),
  ('multi_unit', 'Multi-unit abutment'),
  ('abutment_straight', 'Straight abutment'),
  ('abutment_angled', 'Angled abutment 15°'),
  ('scan_body', 'Scan body'),
  ('impression_coping', 'Impression coping'),
  ('analog', 'Lab analog'),
  ('prosthetic_screw', 'Prosthetic screw')
) as c (type, description);

insert into public.products (type, brand, system, description, is_sample) values
  ('graft', 'Geistlich', 'Bio-Oss', 'Granules 0.25–1 mm, 0.5 g', true),
  ('graft', 'Geistlich', 'Bio-Oss', 'Granules 0.25–1 mm, 1 g', true),
  ('membrane', 'Geistlich', 'Bio-Gide', '25 × 25 mm', true);
