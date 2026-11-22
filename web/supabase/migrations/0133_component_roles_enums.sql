-- Component tracking: new enum values only (used by 0134 and 0135).
-- New values cannot be used in the transaction that adds them, hence their own migration.
alter type public.component_type add value if not exists 'healing_cap';
alter type public.component_type add value if not exists 'temporary_abutment';
alter type public.component_type add value if not exists 'scan_body';
alter type public.component_type add value if not exists 'impression_coping';
alter type public.component_type add value if not exists 'abutment_screw';
alter type public.component_type add value if not exists 'prosthetic_screw';
alter type public.component_type add value if not exists 'temporary_cylinder_screw';
alter type public.product_type add value if not exists 'healing_cap';
alter type public.product_type add value if not exists 'temporary_abutment';
alter type public.product_type add value if not exists 'abutment_screw';
