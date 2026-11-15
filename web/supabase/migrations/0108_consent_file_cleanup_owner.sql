-- A deleted consent record takes its scan with it (0072) — also when it is deleted outside a company session,
-- e.g. by a script (company:restore --delete, a hand clean-up). Owned by tenant_definer (0092), the trigger saw
-- only the session's company's stored_files, so without a session it deleted nothing and left the PDF behind.
-- postgres owns it now (scripts/definer-allowlist.ts): it deletes only the file of the row just deleted, a
-- delete the caller was already allowed to make.
alter function app_private.delete_consent_file() owner to postgres;
