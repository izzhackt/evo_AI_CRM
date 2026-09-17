# Student Portal — small workspace UX pass

Date: 2026-09-18. Baseline: `9a5b47c0` (fresh `origin/main`).
Status: implemented and focused checks passed; independent review/PR pending.
No production deployment.

## Contract and ownership

Owner requests a small, friendly, responsive improvement to the real Student
Portal, with focused checks only. This task owns portal UI, portal CSS and this
note. The coordinating task owns AGENTS, Admissions handoff recovery and release.
The launch plan and DESIGN.md remain governing authority; shared plan files are
intentionally left to that coordinator to avoid concurrent edits.

Keep real Supabase Auth/data, all seven routes, document mutation/idempotency
contracts and private assessments. No new preview, fixture/demo data, provider
calls, accounts, migrations, shared auth changes or VPS release.

## Implementation block

Visual thesis: a calm EVO workspace using existing neutral surfaces and the
current red brand tokens, readable text and one clear action.
Content order: current stage → next Student action → remaining actions → EVO
work/help. Documents show their own measurable review progress, not an invented
percentage of admission completion.
Interaction thesis: restrained focus/hover feedback, honest route-pending status
and explicit upload/refresh states; no decorative or heavy animation.

- Keep the mobile menu reachable while scrolling, show the current section,
  preserve links/Back, Escape focus return and 44px controls.
- Use Next Link pending state for navigation feedback; loading remains inside
  the existing authenticated shell. Preserve errors and provide actionable copy.
- Move the real current-stage label before the overview action queue, improve
  empty-state guidance and keep server action ordering and document anchors.
- Show approved/total document progress and status counts only from the existing
  document DTO. Zero documents means no progress bar or completion claim.
- Distinguish upload, confirmed receipt and subsequent list refresh without
  changing the actual upload API, retries or persistence behavior.
- Align portal-specific CSS with DESIGN.md and existing V3 tokens.

## Evidence and focused acceptance

Live baseline inspected through the existing authorized QA Student session on
app.evoadmissions.com: overview works, documents are empty, and the current
palette is beige/burgundy. This is read-only observation, not upload acceptance.

Run changed-file ESLint, affected portal Node contracts and a focused local
real-Auth browser check of overview/documents/navigation at desktop, 393px and
320px. Use the existing private QA credentials only in process/ignored runtime
configuration. Never publish credentials, personal data or raw browser payloads.
No full suite, migration harness or production deployment is part of this PR.
An unavailable populated document case blocks live progress/upload acceptance;
do not manufacture data to make those paths pass.

Independent exact-head review must assess this plan, the diff and actual
validation evidence before merge. Prepare a separate PR for the coordinator.

### Validation receipt — 2026-09-18

- Node 22.23.1; clean worktree dependencies installed with `npm ci --ignore-scripts`.
- Portal contracts: `node --conditions=react-server --test
  tests/v3-student-portal-ui.test.mjs tests/v3-student-portal-documents-ui.test.mjs`
  — 23/23 passed. The initial invocation without the existing `react-server`
  condition failed at module import; the corrected scoped invocation passed.
- Changed TS/TSX files: ESLint passed; TypeScript program using project options
  reported zero diagnostics in all seven changed TS/TSX files and no global
  diagnostics. This is scoped type validation, not a full project build.
- Bundled actual `documentProgress` helper executed against empty input and all
  five canonical status categories. Submitted is excluded from accepted count;
  correction-required/rejected remain outstanding. This unit check is not live
  document acceptance.
- Real Chrome session on the local Next.js app, connected to the existing
  managed Supabase with public client configuration only: authenticated Student
  overview, documents and new overview→universities link rendered real data.
  An existing authorized loopback Student session was already valid; no account
  creation, password reset, Auth bypass or credential export was needed.
- Desktop, 393px and 320px: visual checks passed. At393px overview scrollWidth
  was383; at320px documents scrollWidth was320 and overview310 (scrollbar),
  never wider than the viewport. Menu control height44px; Escape collapsed it
  and returned focus to the menu button. Documents navigation and browser Back
  updated the current-section label and closed the menu. At scrollY788, the
  mobile menu remained visible at y12.7px; the help anchor stayed accessible.
- QA documents are empty. The real page rendered zero progress elements.
  Populated progress, actual upload/save/retry feedback and an induced server
  failure were not exercised in the live Student case. No data was manufactured
  and no upload was attempted. These remain explicit acceptance limitations.
- No full suite, container/migration gate or production release was run.

## Official guidance checked

- [Next.js useLinkStatus](https://nextjs.org/docs/app/api-reference/functions/use-link-status):
  pending state belongs inside the corresponding Link and may be skipped on a
  prefetched instant navigation; do not simulate a minimum delay.
- [Next.js loading UI](https://nextjs.org/docs/app/api-reference/file-conventions/loading):
  segment loading preserves the shared layout and navigation stays interruptible.
- [React useActionState](https://react.dev/reference/react/useActionState):
  pending and confirmed action result are distinct; no optimistic success label.
- Installed Next.js 16.3.4 documentation is checked before implementation.

## Decisions / amendments

- 2026-09-18: Keep this as a portal-only slice and document local decisions here
  under the owner's parallel-work instruction. No product/schema/authority
  changes; release and shared-plan coordination remain in the source task.
- 2026-09-18 independent review: removed the candidate overview action count.
  Its projection includes at most one document plus payments, so its length is
  not the total outstanding workload. Checklist progress still counts the full
  document projection. Live393px skip-link check after scrolling focused
  `portal-content`; heading top193px stayed below the sticky header bottom94px.
