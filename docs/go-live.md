# Go-live gate

Real courses and real patients start only when every line is ticked, dated and initialled.

## Plans and hosting
- [ ] Vercel plan upgraded to **Pro** (Hobby is for non-commercial use only). Date: ____
- [ ] Supabase plan upgraded to **Pro** for **both** projects: `implant-course-prod` (the academy's data) and `implant-course-control` (the company registry and console sign-in). Daily backups on; point-in-time recovery decision recorded: ____
- [ ] Domain chosen or bought: ____
- [ ] (Optional) Custom domain added on Vercel, with the Supabase Site URL and Redirect URLs updated to match. The app sends HSTS with `includeSubDomains`: put it on a subdomain (e.g. `app.yourdomain.com`), or first make sure every subdomain of the apex works over HTTPS. A new host must also be added to the academy's hosts in the control registry (`tenant:register`), or it gets 404. Do the same for the console (`CONSOLE_HOST`) if it moves to the domain.

## Email (moves from the pilot Gmail account to Resend on the domain)
- [ ] Resend: domain verified (SPF, DKIM).
- [ ] Sign-in emails: Supabase → Authentication → SMTP set to Resend. Invite and password-recovery templates still link to `/auth/confirm` (docs/operations.md → Turning on email verification). One invite tested end to end: email received, password set, dashboard reached.
- [ ] App emails (checklist assignments): Vercel `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` set to Resend's SMTP, with a sender on the domain; Release re-run; one assignment email received.
- [ ] Both Gmail app passwords for `implantcourseapp@gmail.com` revoked (Supabase Auth and app emails) once Resend works.

## Legal and data
- [ ] Written PDPL (Law 151/2020) advice on hosting patient data in Frankfurt received and filed: ____
- [ ] Patient consent wording approved and in use.
- [ ] Pilot data deleted, or kept with documented consent. Pilot temporary passwords rotated.
- [x] Sample catalog verified: no active product flagged "Sample — verify" (checked 2026-10-08 with `npm run catalog-export`). The 153 sample products are inactive; the 220 Oxy Implant products are real.
- [ ] Two hand-added products under the brand "Oxy" (an implant Ø4 × 11.5 and a healing abutment, no reference codes) deactivated in Inventory → Products; stock recorded on the official "Oxy Implant" products.

## Backups and accounts
- [x] Restore rehearsal done once (docs/operations.md §D → Restore rehearsal), into the local dev2 stack since no Supabase slot is free; data checked, stack wiped. Date: 2026-10-08. It found and fixed a lost backup passphrase and a missing `audit_log` in the restore TRUNCATE.
- [ ] `BACKUP_PASSPHRASE` is in the owner's password manager, and a second copy is kept offline.
- [x] Off-site backup copy on: R2 bucket with a 365-day lock, GitHub `R2_*` secrets set, a locked file refused deletion (docs/operations.md §D → Off-site copy). Date: 2026-10-15.
- [ ] Monthly Backup `verify` run green in the month of go-live.
- [ ] Console admin password changed from the temporary one (**Change password** in the console), and the console authenticator's recovery is known: who can delete the factor in the control project.

## Switch on
- [ ] `NEXT_PUBLIC_PILOT` removed in Vercel, and Release re-run.
