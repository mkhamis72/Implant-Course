set local lock_timeout = '5s';

-- Supabase Advisors lint 0011 (function_search_path_mutable): the last eight functions that ran with the
-- caller's search_path. Their bodies name no table, type or function outside pg_catalog except fully
-- qualified ones (app_private.fail in require_reason), and their enum comparisons take the parameter's
-- type, so an empty search_path changes nothing they do. ALTER keeps owner, grants and bodies.
-- tests/db/search-path.test.ts keeps every later function pinned.
alter function app_private.audit_immutable() set search_path = '';
alter function app_private.ledger_immutable() set search_path = '';
alter function app_private.set_updated_at() set search_path = '';
alter function app_private.freeze_tooth_identity() set search_path = '';
alter function app_private.fail(text) set search_path = '';
alter function app_private.require_reason(text, text) set search_path = '';
alter function app_private.component_accepts(public.component_type, public.product_type) set search_path = '';
alter function public.product_category(public.product_type) set search_path = '';
