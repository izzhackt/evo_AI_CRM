# Sidebar Option 2 — design QA

Date: 2026-09-10 Asia/Dubai (checks through 2026-09-09 20:19 UTC).
Scope: approved department navigation, existing Admissions summary shortcut,
and empty-directory guidance. Base: `e0188955c1f954394bfe43f06c2881ae96fe543c`.
The PR and its independent review bind this report to the final commit.

final result: passed

## Reference and actual implementation

- Owner-selected Option 2: `exec-d817d962-e8d3-4f7c-a42d-d42b10e2e7ee.png`,
  1487×1058 pixels, generated in the preceding options discussion.
- Real implementation: `http://localhost:3101/v3/profile`, first Next dev, then
  the successful production build served locally by `next start`. Same existing
  Supabase project and ordinary authenticated Admin; no fixture response or new
  account/database. Production/tunnel3000 and unrelated preview3100 preserved.
- Source and actual screenshot were emitted together in one comparison input.
  Chrome's existing 75% zoom initially caused a measurement mismatch; discarded
  that first measurement, then used temporary emulation without changing zoom.
  Verified desktop CSS viewport1487×1059, DPR≈1; final screenshot1477×1052 is
  the capture backend's proportionally resized output. Compare at equal displayed
  width, not as a pixel-diff. Temporary overrides were removed afterward.
- Additional actual viewports:392×852 and320×852 CSS px. These test reflow;
  the reference supplies no separate mobile mockup.

## Findings and five fidelity surfaces

No unresolved P0/P1/P2 design finding within this bounded scope.

| Surface | Observation and disposition |
| --- | --- |
| Fonts/type | Existing Golos type scale retained; readable14px nav labels, larger page headings, clear parent/child distinction. Not a replacement of the app typography. |
| Spacing/layout | White260px desktop sidebar, nested links, separate Common section, bottom settings/account.44px minimum controls; mobile overlay does not push the page below a long menu. No horizontal document overflow at392/320px. |
| Colors/tokens | Existing EVO red/pale-red selected state, neutral white/gray surfaces and focus tokens; no new palette or gradients. |
| Images/icons | Original EVO logo unchanged, correct aspect ratio, crisp at actual size. Reused the existing icon set instead of reproducing generated mock icons. Child links use indentation rather than redundant icons. |
| Copy/content | Approved Sales/Admissions/Common labels. Summary opens the actual report. Empty state explains case→«Маршрут» and country-filter distinction. No invented student rows. |

Intentional differences: no concept callout from the reference; retain all four
real Admissions metrics (mock showed three); preserve original page layout,
role preview and account controls; Settings is one real link without a fake
submenu. These are explicit implementation constraints in DESIGN.md/launch plan.
Full-view comparison kept the260px sidebar text/icons readable, so no additional
image crop was required. The mobile screenshots separately show the focused
navigation, long summary label and bottom account/exit controls without clipping.

## Actual interaction evidence

- Enter expands Sales; its report link navigates to`/v3/main?view=sales`, opens
  Sales and marks only Sales report current. Main marks only Main current.
- Admissions→summary navigates to`?section=summary#admissions-summary`, reveals
  asynchronously loaded report and focuses its heading. Back restores Main.
- Submitting the real month form retains`section=summary&period=2026-09`;
  report visible after its async read finishes (not just after URL changed).
- Mobile opens/closes navigation; Escape restores focus to the toggle. Tab from
  the last menu control moves to the month input and closes the overlay.
- Selecting the current Worklist link closes mobile navigation; focus is not
  left in a hidden link. No logout action was submitted.
- Admin's existing presentation-only preview: Admissions has no Sales/Main/
  Settings links; Sales has no Calendar/Settings/Admissions summary, but retains
  its restricted case-directory link. Ordinary Admin mode restored and verified.
- Visible nav anchors/buttons measured at least44px high on320px viewport.
- Browser error inventory:18 captured errors belonged to a Chrome extension's
  `toolbar` script, not the EVO origin. Do not call this a globally clean console.
  No EVO-origin console errors found in that captured inventory.

## Verification and limits

- `npm run build`: PASS (Next16.3.4; TypeScript and import bundle included).
- `tsc --noEmit --incremental false`: PASS; scoped ESLint: PASS.
- `npm run test:frontend`:152/152 PASS, including real HTTP-route test.
  First attempt hit our running dev-server lock and the new module inventory;
  corrected inventory, stopped only owned dev preview, reran without skipping.
- Fixed-role settings + brand + staff-auth suites:15/15 PASS. One stale brand
  form-key assertion was aligned with already-existing main behavior.
- New navigation tests:12 real pure-model cases, registered in canonical CI.
- No screen-reader session or new production Student journey was executed.
  This is not full WCAG certification or proof of a populated Admissions case.
- No production release is implied by this local design acceptance.

Implementation checklist: selected layout ✓; real destinations ✓; role boundaries
✓; keyboard/mobile ✓; source/actual comparison ✓; original assets/data ✓.
