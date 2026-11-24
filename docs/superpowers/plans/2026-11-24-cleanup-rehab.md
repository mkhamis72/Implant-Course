# Clean-up after the rehabilitation projects — short design and plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the follow-ups left by projects A, B, C1 and C2 in one small release.

**Approved design (owner, 2026-11-24):**
1. Re-add the planned-product foreign key `implant_sites_planned_product_id_fkey (company_id, planned_product_id) → products (company_id, id)` that 0141 dropped for the release window.
2. Drop `public.fit_component_v2` and `app_private.clear_wrong_closer_links()` (the live app calls only `fit_component_v3`); DB tests that still call v2 move to v3 or are removed where v3 tests already cover them.
3. `set_implant_geometry` refuses a direction without an angle: "Give the angle as well as the direction." Existing rows untouched.
4. A DB test: acting in one company, `set_implant_geometry` on another company's implant changes nothing and is refused.
5. History: an `implant_sites` update that changes only `case_id` reads "Added to full-arch case" / "Removed from full-arch case" (not "Implant on tooth N updated").
6. Full-arch drawing: when one arch has no implants and no bridges, its implant zone collapses (the drawing gets shorter); the browser Back/Forward buttons switch between Teeth and Full arch (`pushState` on switch + `popstate` listener) instead of `replaceState`.

**Approaches:** one release of independent small fixes (chosen); spreading them over the next projects was rejected (they would be forgotten again).

**Spec:** this document (short design). Background: `docs/superpowers/specs/2026-11-23-implant-types-design.md`, `2026-11-22-component-tracking-design.md`, `2026-11-23-full-arch-design.md`.

## Global Constraints
- One migration `web/supabase/migrations/0144_cleanup_rehab.sql`; never edit applied migrations; dry-run in a rolled-back transaction before the first `npm run test:db`.
- Backward-compatible with the previous app version (current master, #139): before re-adding the FK, prove no PostgREST embed in `web/src` reaches `products` from `implant_sites` (or `implant_sites` from `products`) without an explicit `!<fkey>` hint — the FK would make it ambiguous (PGRST201) for the running app. If one exists, hint it in this branch AND stop: report it (that needs a two-release split).
- `set_implant_geometry`: `create or replace` of its latest definition (0140), same signature; keep every existing check and message.
- Re-adding the FK must not fail on existing data: the migration first nulls nothing — instead, if any `planned_product_id` has no matching product in its company, the migration fails loudly (that is a data question for the owner). The controller checks prod read-only before release.
- Root CLAUDE.md and `web/src/app/(app)/patients/CLAUDE.md`: update the lines that say v2 "stays one release" / the planned product has no foreign key.

## Review Focus
1. Previous app version during the release: no ambiguous embed (see constraint) and nothing it calls is dropped (grep `fit_component_v2` in `web/src` = none). → Task 1 report lists the grep evidence.
2. A geometry save with angle and direction, or neither, still works; only direction-without-angle is refused. → Task 1 tests.
3. Back button after several switches returns through the views, then leaves the page normally. → Task 2 component test.

---

### Task 1: Database clean-up (0144) and docs

**Files:** Create `web/supabase/migrations/0144_cleanup_rehab.sql`; modify DB tests that call `fit_component_v2` / `clear_wrong_closer_links` (`web/tests/db/*`), `web/tests/db/implant-types.test.ts`; docs lines in root `CLAUDE.md` and `web/src/app/(app)/patients/CLAUDE.md`.

- [ ] **Step 1: Failing tests** in `implant-types.test.ts`: `direction without angle is refused` (message above); `angle and direction save`; `company isolation for geometry` (company B user, company A site → refused, row unchanged); a test that `implant_sites_planned_product_id_fkey` exists and refuses a product of another company; a test that `fit_component_v2` no longer exists (`to_regprocedure('public.fit_component_v2(...)')` is null — use its exact signature from the migrations).
- [ ] **Step 2:** `npm run test:db -- implant-types` — Expected: new tests FAIL.
- [ ] **Step 3:** Grep evidence for the embed constraint; write 0144 (drop functions; re-add FK; `create or replace set_implant_geometry`); move or remove the v2 callers in tests; dry-run; `npm run test:db` — Expected: all pass. Update docs.
- [ ] **Step 4: Commit** "Clean-up: planned-product key back, old fitting function gone, direction needs an angle (0144)".

### Task 2: History label, drawing height, Back button

**Files:** `web/src/lib/patients/history.ts` (+ test), `web/src/components/full-arch/full-arch.tsx` (+ test), `web/src/app/(app)/patients/[id]/chart-panel.tsx` (+ test).

- [ ] **Step 1: Failing tests:** history — an `implant_sites` update whose only changed field is `case_id` → "Added to full-arch case" (null → id) / "Removed from full-arch case" (id → null), with the tooth; full-arch — a model with only upper items renders a shorter SVG (viewBox height smaller than with a lower implant); chart-panel — switching calls `history.pushState` with `view=arch`, and a `popstate` to a URL without `view` shows Teeth (and with it, Full arch).
- [ ] **Step 2:** `npm test -- history full-arch chart-panel` — Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Keep `tooth` and other params when pushing.
- [ ] **Step 4:** Same tests PASS; `npx tsc --noEmit`, `npm run lint`, `npm test`; `npx playwright test full-arch full-arch-cases chart --project=chromium` (check :3000 first).
- [ ] **Step 5: Commit** "Clean-up: case membership in History, shorter one-arch drawing, Back switches views".
