# Full-arch view (C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Teeth | Full arch" switch on the patient chart; "Full arch" draws both arches schematically with connected bridges, implants by type and angle, and implant-to-bridge links, from data already recorded.

**Architecture:** App only, no migration. Pure model + geometry helpers in `src/components/full-arch/` turn `ChartData` (sites, restoration spans, badges, type labels) into drawable items; a `FullArch` SVG component draws them and reports selection through the chart panel's existing `onSelect`, so the same tooth panel opens. Today's `Odontogram` is not modified.

**Tech Stack:** Next.js 15, React 19 client components, SVG, Tailwind v4 tokens, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-full-arch-design.md` (C1 part and its Settled points).

## Global Constraints
- Today's tooth chart (`src/components/odontogram/*`, its props and clicks) is not changed; its existing tests stay green unmodified.
- No database change, no new query: everything comes from `ChartData` already loaded by `loadChartData`.
- One implant per tooth: use `activeSite(sites, tooth)` (`src/lib/inventory/components.ts`) per tooth; `removed` sites are never drawn.
- Implant kind: `site.implant_type ?? site.product?.implant_kind ?? 'conventional'` (a planned site's `product` is the planned product). Spares are not drawn.
- Planned implants: outline only, upright (angle ignored). Failed implants: drawn in the bad colour with a cross.
- Colours only from design tokens / `COLORS` in `src/components/odontogram/visuals.ts`; status colours never branded.
- Exact copy: switch buttons **"Teeth"** and **"Full arch"**; note under the drawing **"Schematic drawing — not a substitute for CBCT or 3D planning."**
- URL: `?view=arch` selects Full arch on load; switching updates the URL with `history.replaceState`, keeping other params (e.g. `tooth`).
- Accessibility: every implant and bridge is a focusable `role="button"` with Enter/Space, as the tooth chart does.

## Review Focus
1. A patient with no implants and no restorations: Full arch shows empty arches with tooth numbers and the note, no crash. → Task 2 test `renders empty arches`.
2. A tilted implant with no recorded angle, or buccal/palatal direction (not visible from the front): drawn upright, label still says the recorded values. → Task 1 tests `tilted without angle is upright`, `buccal leans nowhere`.
3. A restoration covering a tooth whose implant was removed or not yet placed (span with fewer implant teeth): the bridge still draws over all its teeth, link lines only to its implant teeth. → Task 1 test `links only to implant teeth`.
4. Lower-jaw zygomatic/pterygoid (data entered on a lower tooth by mistake): drawn pointing down like any lower implant, no crash. → Task 1 test `lower jaw points down`.
5. Switching views keeps the selected tooth and the panel open. → Task 3 component test `switch keeps selection`.

---

### Task 1: Full-arch model and geometry

**Files:**
- Create: `web/src/components/full-arch/model.ts`
- Test: `web/src/components/full-arch/model.test.ts`

**Interfaces:**
- Consumes: `ImplantSite`, `ImplantType`, `AngulationDirection` (`src/lib/inventory/types.ts`); `activeSite` (`src/lib/inventory/components.ts`); `Span` (`src/components/odontogram/odontogram.tsx`); `toothLayout`, `TOOTH_W`, `MIDLINE_X` (`src/components/odontogram/layout.ts`); `CHART_ORDER` (`src/lib/patients/fdi.ts`).
- Produces:
  ```ts
  export type ArchImplant = {
    siteId: string; tooth: number; jaw: 'upper' | 'lower';
    kind: ImplantType; planned: boolean; failed: boolean;
    angle: number;            // degrees drawn from vertical, 0 when upright
    lean: -1 | 0 | 1;         // drawn x direction of the apex: -1 left, 1 right
    label: string | undefined;// ZYG / TLT / PTG (from typeLabels), undefined for conventional
    badge: string | undefined;// component badge (from badgesFor)
    description: string;      // accessible text, e.g. "Implant 16, Zygomatic, 45° distal, placed"
  };
  export type ArchBridge = { id: string; teeth: number[]; implantTeeth: number[]; temporary: boolean; label: string };
  export function fullArchModel(input: {
    sites: readonly ImplantSite[]; spans: readonly Span[];
    badges: Partial<Record<number, string>>; types: Partial<Record<number, string>>;
  }): { implants: ArchImplant[]; bridges: ArchBridge[] };
  export const IMPLANT_LENGTH: Record<ImplantType, number>; // conventional 56, tilted 56, zygomatic 130, pterygoid 80 (SVG units)
  export function implantLine(imp: ArchImplant, head: { x: number; y: number }): { x1: number; y1: number; x2: number; y2: number };
  ```

- [ ] **Step 1: Write the failing tests** in `model.test.ts` (build sites with a small local `site()` factory; only the fields used):
  - `conventional placed is upright`: tooth 36 placed, `implant_type: 'conventional'` → `angle 0, lean 0, kind 'conventional', planned false`.
  - `tilted distal on the patient's right leans left`: tooth 15, `tilted`, 30, `distal` → `angle 30, lean -1`; same on 25 → `lean 1`; `mesial` on 15 → `lean 1`.
  - `tilted without angle is upright`: tooth 15, `tilted`, `angulation_deg null` → `angle 0`.
  - `buccal leans nowhere`: `tilted`, 20, `buccal` → `angle 0, lean 0`, `description` contains `20° buccal`.
  - `zygomatic defaults`: tooth 14 `zygomatic`, no angle/direction → `angle 45, lean -1` (distal, away from midline); 24 → `lean 1`. Pterygoid 17 default → `angle 30, lean -1`.
  - `planned uses planned product kind and stays upright`: state `planned`, `implant_type null`, `product.implant_kind 'zygomatic'` → `kind 'zygomatic', planned true, angle 0, lean 0`.
  - `failed is flagged`: state `failed` → `failed true`; `removed` site → not in `implants`.
  - `links only to implant teeth`: span `{teeth:[16..26], implantTeeth:[15,12,22,25]}` → bridge keeps both arrays unchanged.
  - `lower jaw points down`: `implantLine` for a lower implant gives `y2 > y1`; for an upper one `y2 < y1`; zygomatic length 130 → `Math.hypot(x2-x1, y2-y1) ≈ 130`.

- [ ] **Step 2: Run** `npm test -- full-arch/model` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `model.ts`. Rules: kind as in Global Constraints; angle = recorded `angulation_deg` for placed/restored/failed sites, else type default (zygomatic 45, pterygoid 30, others 0); planned → angle 0, lean 0; direction mesial = toward `MIDLINE_X`, distal (and zygomatic/pterygoid with no direction) = away from it, buccal/palatal_lingual → angle 0, lean 0 (the description keeps the recorded values; reuse `typeLine` from `src/lib/patients/implant-type.ts` for its wording). `implantLine` rotates a vertical segment of `IMPLANT_LENGTH[kind]` by `angle` toward `lean`, pointing up for upper, down for lower.

- [ ] **Step 4: Run** `npm test -- full-arch/model` — Expected: PASS.

- [ ] **Step 5: Commit** `git add web/src/components/full-arch && git commit -m "Full-arch model: implants by type and angle, bridges"`

---

### Task 2: `FullArch` drawing

**Files:**
- Create: `web/src/components/full-arch/full-arch.tsx`, `web/src/components/full-arch/legend.tsx`
- Test: `web/src/components/full-arch/full-arch.test.tsx`

**Interfaces:**
- Consumes: Task 1 `fullArchModel`, `implantLine`, `ArchImplant`, `ArchBridge`; `toothLayout`, `TOOTH_W`, `CHART_WIDTH` from the odontogram layout; `COLORS`.
- Produces:
  ```ts
  export function FullArch(props: {
    model: { implants: ArchImplant[]; bridges: ArchBridge[] };
    selected: readonly number[];
    onSelect: (fdi: number, additive: boolean, tab?: 'restoration') => void;
  }): JSX.Element;
  export function FullArchLegend(): JSX.Element; // planned (outline), placed, failed, temporary bridge, final bridge
  ```
- Layout (builder sets proportions): one SVG (`role="img"` wrapper group with `aria-label="Full-arch chart"`), width `CHART_WIDTH`, x positions from `toothLayout()` so teeth line up with the tooth chart. Upper arch: implant zone above (apexes up, room for zygomatic length), then the prosthesis row, then FDI numbers; lower arch mirrored. Prosthesis: each bridge one connected rounded shape across its teeth; pontic units (tooth not in `implantTeeth`) lighter; temporary dashed outline, final solid. Links: a short line from each implant head to its bridge unit. Implant: threaded-looking rect/line along `implantLine`, type label and badge beside the head, outline when planned, bad colour + cross when failed, selected ones highlighted.
- Selection: implant → `onSelect(tooth, shiftKey||ctrlKey||metaKey)`; bridge → `onSelect(bridge.implantTeeth[0], false, 'restoration')`. Accessible names: implant `description`; bridge `"<label>, temporary|final"`.

- [ ] **Step 1: Write the failing tests** in `full-arch.test.tsx`:
  - `renders empty arches`: empty model → renders, `getByText('Schematic drawing — not a substitute for CBCT or 3D planning.')`, numbers 18 and 48 present, no `button`.
  - `implants are buttons named by description`: model with 4 implants → 4 buttons; `getByRole('button', { name: /Implant 14, Zygomatic/ })`.
  - `bridge click opens the restoration tab`: click `getByRole('button', { name: /final/ })` → `onSelect(15, false, 'restoration')`.
  - `implant click and shift-click`: click → `onSelect(36, false)`; shift-click → `onSelect(36, true)`; Enter key on focused implant → `onSelect(36, false)`.
  - `planned and failed are marked`: planned implant has `data-planned="true"`, failed has `data-failed="true"`.
  - `selected implant is marked`: `selected=[36]` → that button has `aria-pressed="true"`.

- [ ] **Step 2: Run** `npm test -- full-arch/full-arch` — Expected: FAIL.

- [ ] **Step 3: Implement** `full-arch.tsx` and `legend.tsx` as above (the schematic note is rendered by `FullArch` under the SVG).

- [ ] **Step 4: Run** `npm test -- full-arch` — Expected: PASS.

- [ ] **Step 5: Commit** `git add web/src/components/full-arch && git commit -m "Full-arch drawing"`

---

### Task 3: The switch on the chart, E2E, docs

**Files:**
- Modify: `web/src/app/(app)/patients/[id]/chart-panel.tsx`, `web/src/app/(app)/patients/[id]/page.tsx`
- Test: `web/src/app/(app)/patients/[id]/chart-panel.test.tsx`, Create `web/tests/e2e/full-arch.spec.ts`
- Docs: `web/src/app/(app)/patients/CLAUDE.md` (a "Full-arch view" paragraph), root `CLAUDE.md` (one line next to "Implant kind")

**Interfaces:**
- Consumes: Task 1 `fullArchModel`; Task 2 `FullArch`, `FullArchLegend`.
- Produces: `ChartPanel` prop `initialView?: 'teeth' | 'arch'` (default `'teeth'`); page reads `view` with `readParams` (`'arch'` → `'arch'`, anything else → `'teeth'`).

- [ ] **Step 1: Write the failing component tests** in `chart-panel.test.tsx`:
  - `shows Teeth by default`: `getByRole('button', { name: 'Teeth', pressed: true })`, the tooth chart present.
  - `switches to Full arch`: click "Full arch" → `getByRole('img', { name: 'Full-arch chart' })`, the schematic note visible, `history.replaceState` called with a URL containing `view=arch`.
  - `initialView arch opens Full arch`.
  - `switch keeps selection`: select tooth 36 on Teeth, switch to Full arch → panel heading still 36.

- [ ] **Step 2: Run** `npm test -- chart-panel` — Expected: the new tests FAIL, existing ones pass.

- [ ] **Step 3: Implement**: a two-button group (`aria-pressed`, `.tabs`/`.tab` styling) above the chart; Full arch renders `FullArch` (model from `useMemo(fullArchModel({ sites: data.sites, spans, badges, types }))`) and `FullArchLegend` in place of the tooth chart and `Legend`; same horizontal-scroll wrapper and Right/Left labels; the tooth panel below is unchanged. Page passes `initialView`.

- [ ] **Step 4: Run** `npm test -- chart-panel full-arch` — Expected: PASS.

- [ ] **Step 5: E2E** `tests/e2e/full-arch.spec.ts` (setup modelled on `tests/e2e/restorations.spec.ts` `setup`, API helpers in `tests/e2e/api.ts`; geometry set through `set_implant_geometry` with the API client): a patient with implants placed at 15, 12, 22, 25, then `set_implant_geometry` 15 and 25 → `tilted`, 30, `distal`; a final full-arch restoration over 15–25 on those four implants. Test `full-arch case shows four implants under one bridge`: open the chart, click "Full arch" → URL has `view=arch`; four implant buttons; `getByRole('button', { name: /Implant 15, Tilted, 30° distal/ })`; one bridge button named `/final/`; clicking it opens the tooth panel on the Restoration tab. Test `teeth view unchanged`: reload without `view` → "Teeth" pressed, tooth 15 shows the `TLT` tag as before.

- [ ] **Step 6: Run** `npx playwright test full-arch chart restorations --project=chromium` — Expected: all pass.

- [ ] **Step 7: Docs**, then `npx tsc --noEmit`, `npm run lint`, `npm test` — Expected: clean / all pass.

- [ ] **Step 8: Commit** `git add -A web docs && git commit -m "Full-arch view on the patient chart"`
