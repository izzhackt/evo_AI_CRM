# EVO role journeys

Status: evidence-backed audit draft; no runtime or production change
Baseline: origin/main d243b2bb370d052750278e7f5cc2625991d5f870, 2026-08-17
Issue: #263

## Evidence boundary

Code and local tests do not prove managed or production behavior. This audit
collected no production evidence. Roles are Admin, Sales, Curator, Finance and
Student. Visa is a module, not a role. amoCRM owns lead, responsible Sales and
sales stage; Platform owns post-contract operations.

## Journey matrix

| Journey | Actor | Input | Action | Data and audit | Notification | Next state | Permission | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Staff access | Any staff role | Supabase session and active membership | Resolve actor and route by role | Membership/role/scope; normal read adds no event | None | Authorized route or pending/denied | Server guard plus RLS/RPC | Invalid/inactive/wrong role denied before read |
| Contract to pending case | Canonical amoCRM integration | Signed-contract mapping, responsible Sales, approved handoff | Create audited pending case | Case and OP handoff with source, actor, next step/deadline | None implied | Await Admin assignment | Never infer from chat or SQLite stage | Missing mapping/ownership remains deferred |
| Assign Curator | Admin | Exact case, active Curator, reason, revision, request ID | Dedicated assignment RPC; first assignment activates Portal | Assignment plus append-only before/after event | No provider send | Active Curator-owned case | Admin only | Wrong org, stale revision or missing reason fails closed |
| Operate Student 360 | Assigned Curator/Admin | Case, route/profile, applied checklist, evidence | Maintain profile, applications, documents, visa and lifecycle | Request-bound domain events | Negative document result only behind exact flag | Independent workstreams | Assigned Curator/Admin | Missing OZO/checklist warns; wrong scope denied |
| Sales handoff | Responsible Sales | Canonical amoCRM owner/stage | Own pre-contract queue; post-handoff read safe summary | amoCRM authority and audited handoff | No unattended send | Sales follow-up or limited summary | Responsible Sales only | Missing/conflicting linkage unavailable |
| Application | Assigned Curator/Admin | Case, institution, program, status, evidence | Create one application and change status | Application plus append-only status events | Portal read only | Independently tracked application | Case-scoped RPC | Evidence-required or cross-case input denied |
| Document | Student and Curator/Admin | Own slot, PDF/JPG/PNG, validation result | Reserve, finalize, validate, review, resubmit | Immutable versions and access/review events | Safe negative-review notification when enabled | Approved/review/correction | Self-only upload and scoped review | Scanner unknown/failure never succeeds |
| Visa | Assigned Curator/Admin | Country, status, evidence, next action | Create/update visa case | Visa row plus append-only events | Portal read only | Independent visa state | No separate Visa role | Missing evidence or wrong scope denied |
| Finance | Finance/Admin by contract | Obligation, amount/currency/date/evidence | Record obligation/payment/refund and stop factor | Evidence-backed events and audit | Safe overdue Portal projection | Derived finance state | Current connected UI is Admin-only gap | Browser cannot infer paid from sales stage |
| Student Portal | Student after assignment | Own session; no chosen case ID | Read all Portal routes; acknowledge eligible notification | Self-only RPCs; acknowledgement audited | Feature-gated durable feed | Clear next action/contact | Self-only RLS/RPC | Missing case pending; upload/send/edit unavailable |
| Close/reopen | Admin or assigned Curator | Exact case, reason, revision/request | Dedicated lifecycle RPC | Before/after lifecycle event; history retained | None implied | Closed or active | Admin/current Curator | Broad update/unrelated role denied |

## Repository evidence

- Identity/RBAC: migrations 041 and 047; src/lib/platform-guards.ts.
- Cases/applications/visa/tasks: migration 042 and admissions tests.
- Documents/finance: migrations 043, 046, 055 and document/P6 tests.
- OZO/profile/contracts: migrations 051-053 and 057.
- Portal notifications: migrations 068-070 and P6 tests.
- Student 360 adapter: src/app/(staff)/clients/[id]/PlatformClientPage.tsx.

## Conclusions

Student 360 plus the read-only Portal is the strongest connected path, not the
whole operating system. Global documents, visa and finance routes remain
legacy. Student 360 tasks, updates and audit are empty. Finance is a schema/DB
role but connected payment mutations are Admin-only. None of this is current
production proof.
