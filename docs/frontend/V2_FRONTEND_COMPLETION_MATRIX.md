# V2 frontend completion matrix

Status: V2-11 local frontend completion evidence ledger.

Initial audit baseline: `f87bd37fa4ed2b88b35fc2a263459f5d1bcff0a0`.

Validated current-main implementation: `638a027fd9904e67105d2de51f559b2153752bc0`
on 2026-08-31 (+04). Exact-main EVO Platform CI run `33348880349` is the
successful merge-level check for this snapshot.

Runtime: the root Next.js application on the real local PostgreSQL V2 contract;
no `EVO_UI_CONTRACT_FIXTURES`, demo seed, mock provider or fallback repository.
Historical Claude Design screenshots and the 2026-08-29 UX/UI package informed
visual intent only and are not runtime, provider or production proof.

## Evidence levels and completion boundary

| Level | Result | Meaning |
| --- | --- | --- |
| Code | Complete for the V2-11 staff frontend slice. | The route, fixed-role policy, component and outcome contracts pass on the reviewed implementation. |
| Local V2 runtime | Complete for the sampled end-to-end staff journey. | The root app rendered real local PostgreSQL records for Admin, Sales and Admissions without fixture, demo or fallback paths. |
| Provider | Not proved in this run. | No Gemini request, WAHA send or amoCRM write was authorized or attempted. The UI fails closed and discloses the current server state. |
| Production | Not proved and not authorized. | No deploy, production provider action or real customer-data mutation occurred. |

“Frontend complete” below means Code plus Local V2 runtime for the active
private staff product. It never means that external providers or production
have been accepted.

## Delivery and review ledger

| PR | Exact head | Merge commit | Delivered result |
| --- | --- | --- | --- |
| #509 | `73e73615eab8f81b532ec03fcddede5a0879837f` | `9f807693a43baabb836db8763470ec88bef9e22b` | V2-11 contract and initial target/current/runtime matrix. This PR was merged externally before the controller received the reviewer verdict; the later independent current-main audit covers its contract rather than hiding that sequencing exception. |
| #510 | `dd9656e35f3df3f003cb6976d67b6ee6be5f6962` | `e96a9298cca24428c8ae394691197cebd01d0be2` | Runtime-derived shell/provider disclosure, exact fixed-role navigation, current V2 copy and route titles/headings. |
| #511 | `2a090230ede08019dfcfd1722a105c0cf6b5fa04` | `101245ad993427364442dcf5ab088820bee464d9` | Bounded Sales mobile queue and selected WhatsApp work before the hidden mobile queue. |
| #512 | `a63776b17375e9123be2cf4c779fdf41bc00748f` | `81d6e30a3ec16563ddc20f3979bc499474a8467d` | Nearest useful loading and error boundaries for Applications, Visa, Finance and Tasks. |
| #513 | `45d125e289553a9c6529cfed2f15ffe56346cb7c` | `83c6031cf1d0e6268350ff1082761df55e927f70` | Student 360 section navigation, 44 px mobile controls and focused accessibility contracts. |
| #514 | `a413fcc7e29b98567e8be9d24f17bc5aeeab42de` | `638a027fd9904e67105d2de51f559b2153752bc0` | Separate dark-theme accent-text token with normal-text contrast while preserving the EVO brand fill. |

PRs #510 through #514 received an independent exact-head approval and green
exact-head CI before merge. Every merge was followed by exact-main CI before
the next implementation block.

## Role and route completion matrix

| Surface | Allowed roles | Active route | Current code and real-runtime result | Verdict |
| --- | --- | --- | --- | --- |
| Private gate | Admin, Sales, Admissions | `/login` | Two-field local development gate clearly says it is not production authentication. | Complete locally. |
| Sales pipeline | Admin, Sales | `/sales` | Real PostgreSQL queue, 15-row bounded page, validated cursor/filter, empty filter state and practical mobile height. Admissions is denied. | Complete locally. |
| Lead 360 and qualification | Admin, Sales | `/sales/[id]` | Real lead shows owner, stage, qualification, provider disclosure and contract/first-payment evidence. | Complete locally. |
| Audited handoff | Admin, Sales action; Admissions receives | Lead 360 action and linked Student Case | A real handed-off record links gate evidence to Student 360. Audit was read-only; no handoff was triggered. | UI and read path complete; mutation deliberately not repeated. |
| Student queue | Admin, Admissions | `/clients` | Real PostgreSQL cases render; Sales is denied. | Complete locally. |
| Student 360 | Admin, Admissions | `/clients/[id]` | One canonical case surface exposes audited handoff, tasks, documents, applications, visa and finance stop/release with six reachable section links. | Complete locally. |
| Applications | Admin, Admissions | `/applications` | Real queue, nearest loading/error recovery and canonical Student 360 write link. Sales is denied. | Complete locally. |
| Documents | Admin, Admissions | `/documents` | Real queue with explicit loading/error/empty behavior. Sales is denied. | Complete locally. |
| Visa | Admin, Admissions | `/visa` | Visible in the correct shell, real queue, nearest loading/error recovery. Sales is denied. | Complete locally. |
| Finance | Admin, Admissions | `/finance` | Visible as a module, never a role; real minimal stop/release queue and nearest loading/error recovery. Sales is denied. | Complete locally. |
| Tasks | Admin, Admissions | `/tasks` | Real operational queue and nearest loading/error recovery. Sales is denied. | Complete locally. |
| WhatsApp inbox | all three, role-scoped | `/whatsapp` | One PostgreSQL-backed inbox: Admin union, Sales pre-handoff, Admissions handed-off. Mobile hides the queue after a conversation is selected. | Complete locally. |
| Human-reviewed conversation | all three, role-scoped | `/whatsapp/[id]` | Transcript and linked case render; Gemini advisory state, 44 px confirmation control and one explicit send action fail closed. No provider call occurred. | UI complete; provider proof absent. |
| Settings and role preview | Admin | `/settings` and shell preview | Admin previews the exact Admin, Sales or Admissions navigation. Non-admin roles are denied. | Complete locally. |
| Deferred modules | none in active V2 core | `/dashboard`, `/calls`, `/chat`, `/notifications`, `/reports`, `/portal` | Fixed staff roles fail closed to `/platform-pending`; no core journey depends on them. | Correctly deferred. |

## Navigation and negative permissions

| Effective role | Exact visible primary navigation | Direct negative proof |
| --- | --- | --- |
| Admin | Sales, Student 360, Applications, Documents, Visa, WhatsApp, Tasks, Finance, Settings | Admin remains the functional superset and can preview the other exact interfaces. |
| Sales | Sales, WhatsApp | Direct `/clients` redirects to `/access-denied?from=%2Fclients`; Admissions-only routes remain server denied. |
| Admissions | Student 360, Applications, Documents, Visa, WhatsApp, Tasks, Finance | Direct `/sales` is denied; Sales-only work is not exposed. |

Finance remains an Admissions/Admin module. Marketing and Student Portal remain
outside the active V2 staff core.

## State and accessibility completion matrix

| Check | Current evidence | Verdict / limit |
| --- | --- | --- |
| Loading | Nearest route `loading.tsx` boundaries cover all core queues and conversations; focused contracts and CI build pass. | Complete by code/outcome evidence; no artificial delay was added merely to make a screenshot. |
| Error | With the same app pointed at a deliberately unreachable PostgreSQL URL, `/applications` rendered “PostgreSQL did not respond” plus retry and queue recovery, with no legacy source. | Real fail-closed runtime proof complete. |
| Not found | Detail routes keep local not-found behavior and query/cursor parsing fails closed. | Complete for active routes. |
| Access denied | Negative direct-route checks for Sales and Admissions land on the explicit denied surface. | Complete and server enforced. |
| Blocked/not configured | Shell badges derive from server flags; conversation copy distinguishes absent authorization, invalid recipient and no current verification. | Truthful local disclosure complete; provider acceptance is not claimed. |
| Empty | Sales safely filtered with `no-such-evo-lead-20260831` and rendered the real zero-result state without changing the database. | Real runtime proof complete. |
| Headings and titles | Core routes have descriptive metadata and one page-level `h1`; shell context is subordinate. | Complete by focused contracts and browser inspection. |
| Reflow | No document-level horizontal overflow on sampled 1280, 834 or 390 px views. | Complete for the required viewports. |
| Target size | Student 360 quick links are 44 px; WhatsApp back link is 44 px; confirmation input remains 20 px inside a 56 px labelled target. | Meets the current mobile target-size contract. |
| Keyboard and focus | Skip link, native links/buttons/inputs and global `:focus-visible` 2 px outline plus 3 px halo are covered by focused tests; no trap was observed. | Code and browser inspection complete. The in-app wrapper did not provide a reliable full manual Tab-order trace, so that stronger claim is not made. |
| Contrast | Corrected direct-text evaluator reports zero normal/large-text failures on Sales, Lead 360, Student 360 and WhatsApp in light and dark themes. Dark accent text is 5.06:1 on the normal surface and 4.63:1 on the weak-accent surface. | Complete for sampled core pages; brand fill remains `#d70217`. |

## Responsive current-main evidence

| Viewport | Current-main route | Measured result |
| --- | --- | --- |
| Desktop 1280x720 | Admin `/sales` | 15 rows, full Admin navigation, no horizontal overflow. |
| Desktop 1280x720, dark | Lead 360 | Gate/provider/detail content visible, no overflow, zero sampled contrast failures. |
| Tablet 834x1194 | Student 360 | Six 44 px quick links, scrollable section navigation, no document overflow. |
| Mobile 390x844 | WhatsApp conversation | 44 px back target, 56 px confirmation label, unchecked send approval, queue removed from layout, no overflow. |

## Provider-truth ledger

| Provider | Current local runtime | Claim boundary |
| --- | --- | --- |
| PostgreSQL | Connected to the real local V2 schema; core queues and detail pages rendered real records. | Sampled local V2 reads are proved. |
| Gemini | Feature presentation is enabled, current authorization is absent, and no request was made. | Human-review UI and fail-closed disclosure are proved; Gemini provider behavior is not. |
| WhatsApp/WAHA | Current authorization is absent, the sampled recipient is invalid, confirmation stayed unchecked and no send was attempted. | Fail-closed human-send UI is proved; delivery is not. |
| amoCRM | Current write authorization is absent and no sync was attempted. | Local disclosure is proved; provider write/reconciliation is not. |

## Negative active-runtime inventory

The current core staff routes and shell have no active Supabase authority,
`EVO_UI_CONTRACT_FIXTURES`, U2/old-PR delivery copy, `Legacy*`, `Connected*` or
`Fixture*` component path. Explicit error copy may say that no legacy source or
fallback screen is used; that is a fail-closed guarantee, not a fallback.
Deferred portal code remains outside the active fixed-role route graph and is
not imported as V2 authority.

Focused outcome contracts:

- `tests/v2-frontend-shell-truth.test.mjs`
- `tests/v2-frontend-mobile-access.test.mjs`
- `tests/v2-frontend-route-states.test.mjs`
- `tests/v2-frontend-accessibility-navigation.test.mjs`

## Current-main screenshot ledger

These local artifacts were captured from exact current main
`638a027fd9904e67105d2de51f559b2153752bc0`. They are intentionally ignored by
Git and do not imply provider or production proof.

- `output/playwright/frontend-final-20260831/current-main-01-admin-sales-desktop.png`
- `output/playwright/frontend-final-20260831/current-main-02-student360-tablet.png`
- `output/playwright/frontend-final-20260831/current-main-03-whatsapp-mobile.png`
- `output/playwright/frontend-final-20260831/current-main-04-lead360-dark.png`
- `output/playwright/frontend-final-20260831/15-applications-real-database-error.png`

## Completion checklist

- [x] V2-11 contract and matrix are present; the final accumulated current-main state receives independent review in the completion-evidence PR.
- [x] Navigation matches server access for Admin, Sales and Admissions.
- [x] Current-runtime provider badges derive from server configuration and result state.
- [x] Active core UI contains no stale Supabase/U2/old-PR/fixture authority or fallback path.
- [x] Core routes have descriptive titles and one main heading.
- [x] Sales and selected WhatsApp work are practically reachable on mobile.
- [x] Loading, empty, error, denied, blocked and not-configured states are covered.
- [x] Focus, contrast, target size and reflow gates pass within the evidence limits stated above.
- [x] Typecheck, lint, focused tests and production build passed on exact implementation PR heads.
- [x] Admin/Sales/Admissions browser journeys passed on the real no-fixture local V2 runtime.
- [x] Fresh desktop, tablet and mobile current-main screenshots were captured.
- [x] Provider and production proof remain separate and truthful.

## Remaining external gates

Real Gemini, WAHA and amoCRM acceptance requires the exact provider credential,
authorization and resolvable target plus a separately authorized side effect.
Production proof requires a separately authorized deploy and production-entry
verification. These gates do not conceal a remaining local frontend defect, and
this run did not broaden authority to cross them.
