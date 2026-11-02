set local lock_timeout = '5s';

-- One shared database: each tenant (host mapping) carries the company it serves.
-- Nullable so the previous app version keeps working; the app treats a null company as suspended.
alter table public.tenants add column company_id uuid;

update public.tenants set company_id = 'a7c0de00-0000-4000-8000-000000000001' where slug = 'academy';
