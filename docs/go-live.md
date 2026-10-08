# Go-live gate

Real courses and real patients start only when every line is ticked, dated and initialled.

- [ ] Vercel plan upgraded to **Pro** (Hobby is for non-commercial use only). Date: ____
- [ ] Supabase plan upgraded to **Pro**, with daily backups on. Point-in-time recovery decision recorded: ____
- [ ] Domain chosen or bought: ____
- [ ] Resend: domain verified (SPF, DKIM). Supabase → Authentication → SMTP set to Resend. Invite and password-recovery email templates written and tested.
- [ ] Vercel `EMAIL_ENABLED=true`. One invite tested end to end: email received, password set, dashboard reached.
- [ ] Written PDPL (Law 151/2020) advice on hosting patient data in Frankfurt received and filed: ____
- [ ] Patient consent wording approved and in use.
- [ ] Pilot data deleted, or kept with documented consent. Pilot temporary passwords rotated.
- [ ] Sample catalog fully verified: no product still flagged "Sample — verify" (check with `npm run catalog-export`).
- [ ] `NEXT_PUBLIC_PILOT` removed in Vercel, and Release re-run.
- [x] Restore rehearsal done once (docs/operations.md §D → Restore rehearsal), into the local dev2 stack since no Supabase slot is free; data checked, stack wiped. Date: 2026-10-08. It found and fixed a lost backup passphrase and a missing `audit_log` in the restore TRUNCATE.
- [ ] `BACKUP_PASSPHRASE` is in the owner's password manager, and a second copy is kept offline.
- [ ] (Optional) Custom domain added on Vercel, with the Supabase Site URL and Redirect URLs updated to match. The app sends HSTS with `includeSubDomains`: put it on a subdomain (e.g. `app.yourdomain.com`), or first make sure every subdomain of the apex works over HTTPS.
