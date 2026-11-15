-- Error alerts: the app records its server errors here (src/lib/errors/report.ts, through the API with the service
-- role), and the hourly Error alert workflow reads the new ones, emails the owner by failing, and deletes rows
-- older than 30 days. error_alert_state remembers how far the check got (one row). Messages are cut to 1000
-- characters and have email addresses and tokens masked before they are sent; they belong to no company.
create table public.error_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  message text not null check (length(message) between 1 and 1000),
  path text check (length(path) <= 300)
);
create index error_log_at on public.error_log (at);

create table public.error_alert_state (
  id smallint primary key check (id = 1),
  checked_at timestamptz not null
);

-- Closed to company users; the service role writes and reads; tenant_definer gets the same policy as on every
-- other table (0092).
alter table public.error_log enable row level security;
alter table public.error_log force row level security;
create policy error_log_tenant_definer on public.error_log for all to tenant_definer using (true) with check (true);
revoke all on public.error_log from public, anon, authenticated, service_role;
grant select, insert, delete on public.error_log to service_role;

alter table public.error_alert_state enable row level security;
alter table public.error_alert_state force row level security;
create policy error_alert_state_tenant_definer on public.error_alert_state for all to tenant_definer using (true) with check (true);
revoke all on public.error_alert_state from public, anon, authenticated, service_role;
grant select, insert, update on public.error_alert_state to service_role;
