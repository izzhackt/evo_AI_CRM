# V2 frontend completion matrix

Status: active V2-11 evidence ledger.

Audit baseline: `f87bd37fa4ed2b88b35fc2a263459f5d1bcff0a0` on 2026-08-31 (+04).

Runtime: root Next.js app on the real local PostgreSQL V2 contract; no
`EVO_UI_CONTRACT_FIXTURES`, demo seed, mock provider or fallback repository.

This matrix compares the intended private V2 staff product with current code
and current browser behavior. Historical Claude Design screenshots and the
2026-08-29 UX/UI evidence package inform visual intent only. They are not
runtime, provider or production proof.

## Evidence levels

| Level | Meaning |
| --- | --- |
| Code | Route, policy or component exists and passes static tests. |
| Local V2 runtime | The root app rendered from the real local PostgreSQL V2 database with no fixture/demo/fallback mode. |
| Provider | The current runtime exercised the real external provider and reconciled the result. |
| Production | The exact code was deployed and verified through the real production entry point. |

The current long run has Code and Local V2 runtime evidence. It does not have
current provider or production authority, so those two levels remain explicitly
unproved even where earlier acceptance evidence exists.

## Role and route matrix

| Surface | Target roles | Current route and code | Current real-runtime result | Disposition |
| --- | --- | --- | --- | --- |
| Login/private gate | Admin, Sales, Admissions | `/login`, development gate | Works and truthfully states that this is the private local V2 gate, not production auth. | Keep; add route-specific title check. |
| Sales pipeline | Admin, Sales | `/sales`, `SalesWorkspace` | Reads 41 PostgreSQL leads. Admin/Sales allowed; Admissions denied. Mobile page is about 9,816 px high before all 41 rows finish. Active copy still says Supabase, U2 and old PR/inbound blocked. | Fix truth copy and bounded queue usability. |
| Lead 360 and qualification | Admin, Sales | `/sales/[id]`, `SalesLeadWorkspace` | Real lead opens with owner, stage, gate evidence, provider panels and linked Student Case. Admissions denied. | Keep one authority; correct current-runtime provider wording and title/heading semantics. |
| Audited handoff | Admin, Sales action; Admissions receives | Lead 360 server actions and repository | Existing handed-off lead links to a real Student Case with contract/payment evidence. No mutation executed in this audit. | Preserve gate and negative role tests. |
| Student queue | Admin, Admissions | `/clients`, `StudentQueue` | Reads 12 PostgreSQL cases. Sales denied. | Keep; validate empty/error/loading and bounded navigation. |
| Student 360 | Admin, Admissions | `/clients/[id]`, `CanonicalStudentCaseWorkspace` | Real case renders handoff evidence, tasks, documents, amoCRM, applications, visa and finance stop/release in one very long page. Sales denied. | Add navigable section structure without creating another write surface. |
| Applications queue | Admin, Admissions | `/applications` | Direct route works; Sales denied. Queue is read-only and Student 360 remains the write surface. | Add missing route loading/error boundary and title; verify empty/blocked states. |
| Documents queue | Admin, Admissions | `/documents` | Direct route works; Sales denied. Existing loading and error boundaries are present. | Verify settled loading/error/empty states and title. |
| Visa queue | Admin, Admissions | `/visa` | Direct route works for both roles and Sales is denied, but Visa is absent from their visible navigation. | Fix shell route filter; add loading/error/title coverage. |
| Finance stop/release | Admin, Admissions | `/finance` | Direct route works for both roles and Sales is denied, but Finance is absent from their visible navigation. | Fix shell route filter; retain Finance as a module, never a role; add state/title coverage. |
| Tasks | Admin, Admissions | `/tasks` | Direct route works; Sales denied. Current page is a long operational queue. | Verify responsive grouping and add state/title coverage. |
| WhatsApp inbox | all three, role-scoped | `/whatsapp`, `CanonicalStaffWhatsAppWorkspace` | Admin sees the union, Sales pre-handoff rows, Admissions handed-off rows. PostgreSQL is the only queue source. Empty instruction still names Supabase. | Remove stale implementation jargon; retain role-scoped authority and cursor path. |
| WhatsApp conversation and human review | all three, scoped | `/whatsapp/[id]`, canonical Gemini/send panels | Real handed-off conversation renders transcript, linked case, Gemini disabled/not configured, invalid recipient, human confirmation checkbox and disabled one-send button. No provider call or send executed. On mobile the selected conversation follows the full queue. | Put selected work within practical mobile reach; preserve explicit human review and fail-closed send. |
| Settings/role preview | Admin | `/settings`; shell Admin preview controls | Admin can preview exact `admin`, `sales` and `admissions` interfaces. Non-admin roles are denied. | Keep and cover exact nav parity for each preview. |
| Deferred modules | none in active V2 core | `/dashboard`, `/calls`, `/chat`, `/notifications`, `/reports`, `/portal` | Fixed-role users are redirected to `/platform-pending`; no core workflow depends on them. | Keep out of active nav and completion claims. Do not revive legacy runtime. |

## Navigation contract

| Effective role | Required primary surfaces | Current visible surfaces | Verified gap |
| --- | --- | --- | --- |
| Admin | Sales, Student 360, Applications, Documents, Visa, Finance, Tasks, WhatsApp, Settings | Sales, Student 360, Applications, Documents, Tasks, WhatsApp, Settings | Visa and Finance are filtered by `CONNECTED_STAFF_ROUTES` despite server access. |
| Sales | Sales, WhatsApp | Sales, WhatsApp | No missing core module observed. |
| Admissions | Student 360, Applications, Documents, Visa, Finance, Tasks, WhatsApp | Student 360, Applications, Documents, Tasks, WhatsApp | Visa and Finance are filtered despite server access. |

## State and accessibility matrix

| Check | Current evidence | Gap or next proof |
| --- | --- | --- |
| Loading | Route boundaries exist for WhatsApp, Documents, Settings and Notifications. | Core Applications, Visa, Finance and Tasks lack a nearest useful loading boundary. |
| Error | Route boundaries exist for Sales, Clients, WhatsApp, Documents, Settings and Notifications. | Core Applications, Visa, Finance and Tasks lack a nearest useful error boundary. |
| Not found | Lead 360 and Student 360 have local not-found states. Query parsers fail closed. | Add one safe global/route fallback only where it improves a verified core path. |
| Access denied | Direct negative checks sent Sales away from Admissions modules and Admissions away from Sales/Settings. | Preserve server enforcement and retest every fixed role after shell changes. |
| Blocked/not configured | Conversation body truthfully says Gemini is off and the recipient is invalid. | Shell badges hard-code `blocked`, which falsely collapses not-configured, not-verified-here and real provider failure. |
| Empty | Queues include empty-state components/copy. | Exercise real empty query/state without fixtures or destructive database edits; use safe filters or repository outcome tests. |
| Headings | Main content and TopBar both expose level-one headings on core screens. | Keep one clear page `h1`; make shell context subordinate or non-heading. |
| Document titles | Core pages share one generic title. | Add descriptive per-route metadata so screen-reader route announcements identify the new page. |
| Reflow | No document-level horizontal overflow at 1280, 834 or 390 px on sampled Sales, Student 360 and WhatsApp pages. | Sales and WhatsApp are vertically impractical on mobile; selected conversation follows the full queue. |
| Target size | One inline Student Case link is 16 px high and the send-confirmation checkbox is 13x13 px in the sampled mobile conversation. | Verify spacing exception for the link; enlarge the checkbox/control target using existing form patterns. |
| Keyboard/focus | Skip link exists and core controls are native links/buttons/inputs. | Complete focus-order and visible-focus proof after implementation; retain no keyboard trap. |
| Contrast | Semantic status tokens are used throughout the core UI. | Run automated contrast checks plus manual review on light/dark themes after final styling changes. |

## Responsive evidence sampled on current main

| Viewport | Routes sampled | Result |
| --- | --- | --- |
| Desktop 1280x720 | Login, Sales, Lead 360, Student 360, WhatsApp inbox/conversation | No global horizontal overflow. Full core data is present. Long pages and stale shell/provider copy remain. |
| Tablet 834x1194 | Student 360 | Sidebar and content reflow without global horizontal overflow; the case remains a roughly 5,901 px single page without section navigation. |
| Mobile 390x844 | Sales, WhatsApp conversation | Bottom navigation and header render without global horizontal overflow. Sales is roughly 9,816 px high; selected WhatsApp work begins after the full conversation list. |

## Provider-truth ledger

| Provider | Current local runtime | What may be claimed |
| --- | --- | --- |
| PostgreSQL | Connected; core queues and detail pages rendered from the real local V2 schema. | Local V2 data authority proved for sampled reads. |
| Gemini | Current conversation says the feature is off; no request was made. | Not configured/available in this runtime; human-review UI is present. No current provider proof. |
| WhatsApp/WAHA | Current recipient is deliberately invalid and send is blocked; no send was attempted. | Human-confirmed fail-closed UI is present. No current provider-send proof. |
| amoCRM | Current detail states that the local runtime lacks the required configuration; no sync was attempted. | Not configured/verified in this runtime. Earlier acceptance is historical evidence only. |

## Completion checklist

- [ ] V2-11A matrix and contract independently reviewed and merged.
- [ ] Navigation matches server access for all three fixed roles.
- [ ] Current-runtime provider badges derive from real server configuration/result.
- [ ] No active core UI copy names Supabase, U2, an old PR, fixtures or a fallback.
- [ ] Core routes have descriptive titles and one main heading.
- [ ] Sales and selected WhatsApp work are practically reachable on mobile.
- [ ] Required loading, empty, error, denied, blocked and not-configured states are covered.
- [ ] Keyboard, focus, contrast, target size and reflow gates pass in light and dark themes.
- [ ] Typecheck, lint, focused tests and production build pass on exact PR heads.
- [ ] Final Admin/Sales/Admissions browser journey passes on the real no-fixture local V2 runtime.
- [ ] Fresh desktop, tablet and mobile screenshots are attached to the completion audit.
- [ ] Provider and production proof remain separate and truthful.
