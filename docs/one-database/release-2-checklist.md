# Before shipping release 2

Owner, read-only, on prod:

```sql
select rolbypassrls from pg_roles where rolname = 'postgres';
```

It must return `true`. Migration 0085's forced-RLS backfill of `company_members` depends on the migrating role bypassing RLS. If it returns `false`, stop and ask before shipping.
