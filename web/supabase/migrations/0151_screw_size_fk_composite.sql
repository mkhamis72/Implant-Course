-- 0149's site_components_screw_size_fkey pointed at screw_sizes (id) alone; the one-database guard wants every
-- foreign key between company tables to carry company_id. Same name (the app embeds through it), now
-- (company_id, screw_size_id) -> screw_sizes (company_id, id), so a size of another company cannot be linked.

alter table public.site_components drop constraint site_components_screw_size_fkey;
alter table public.site_components
  add constraint site_components_screw_size_fkey foreign key (company_id, screw_size_id)
  references public.screw_sizes (company_id, id);
