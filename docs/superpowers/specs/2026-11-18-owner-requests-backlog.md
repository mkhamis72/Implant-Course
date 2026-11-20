# Owner requests backlog (2026-11-18), to resume

> Status: parked (weekly usage limit). Part B is designed and planned; the rest still needs a design, one at a time.

## The owner's words (2026-11-18)
> When booking a surgery I should be able to select from patients to avoid mixing up ids by organizers — search by patient name and opening file to confirm it is intended patient — and when selecting tooth and implant we also want to add spare implants for each tooth that we want available, and when editing I want to be able to edit tooth site, implant planned and spare as well.
> Consent must be changed for clinicians: draft a new one for clinicians, no mention of course nor course delegates etc., consent drafted for regular clinic.
> For schedule no need to add surgery day; clinician can book surgery directly and he can optionally specify GA in hospital / in clinic.
> Centre / clinician can also remove products, to avoid mix-ups with products he doesn't use, and only have the products he uses instead of the full catalogue.
> And we should have pre-uploaded catalogues for multiple common systems that users can just select to activate specific products from, instead of having to manually enter each one.
> When assigning a new user in a clinic: no organizer; admin/doctor.
> For recall visits: being able to adjust specific recall visits' date or period.

## Grouped
| Part | What | State |
|---|---|---|
| **B. Clinic workflow** | Direct booking with Where (In clinic / GA in hospital); Admin/Doctor roles with linked doctors; clinic consent (EN+AR) | Design `2026-11-18-clinic-workflow-design.md` (+pdf) and plan `../plans/2026-11-18-clinic-workflow.md` (+pdf). Awaiting the owner's go; recommended subagent-driven. |
| **A. Booking a surgery** | Patient picker (search by name, open file to confirm); planned + spare implants per tooth; edit tooth, planned implant and spares | To design |
| **C. Product catalogue** | Hide products a company doesn't use; ready-made catalogues for common implant systems to activate | To design |
| **D. Recall visits** | Adjust a specific recall visit's date, or the recall period | To design |

## Modular follow-ups (small, designed in chat 2026-11-18, not yet planned)
1. **Patient History labels** (`src/lib/patients/history.ts`).
   - **Bug for all companies:** `placing_doctor_id` and `implant_sites.course_id` have no label, so "corrected to a doctor" or a course change shows only "Implant on tooth N updated".
   - **Fix:** add `placing_doctor_id: 'placed by'` and `course_id: 'course'` to `PLACEMENT_FIELD_LABELS`.
   - **In a clinic** the labels "assisted by", "supervisor", "delegate" and "course" appear.
   - **Fix:** `describeChange(e, { teaching })`. When teaching is off, drop those labels, and use the generic text if nothing visible changed. `history/page.tsx` passes `teachingOn(profile.features)`.
2. **Drop the previous-version functions:** `place_implant_v3`, `correct_placement_v2`, `create_surgery_slot`, `update_surgery_slot`, and the defaulted `slot_conflicts`.
   - The app no longer calls them (verified 2026-11-18), and 0121 already guards them in a clinic.
   - One migration drops them with exact signatures.
   - About 7 DB test files must be moved to the new names. Remove the dropped names from the guard allow-lists.
   - Note: if part B ships first, the current `create/update_surgery_slot_v2` become "previous" too.
