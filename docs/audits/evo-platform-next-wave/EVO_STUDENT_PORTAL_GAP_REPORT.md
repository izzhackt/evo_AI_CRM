# EVO Student Portal gap report

Status: evidence-backed audit draft; no runtime or production change
Baseline: origin/main d243b2bb370d052750278e7f5cc2625991d5f870, 2026-08-17

## Current state

Portal access is self-only and activates after contract-confirmed Admin
assignment. Home, profile, applications, documents, visa, payments, messages,
notifications and team routes exist. Evidence is code/local only.

| Capability | State | Honest boundary |
| --- | --- | --- |
| Auth/self-only access | Connected | No managed identity proof here |
| Home/next action | Connected | Coarse derived progress |
| Applications | Read-only | No deadline/intake/provider submission |
| Documents | Read-only | Page explicitly says upload/re-upload unavailable |
| Visa | Read-only | No appointment/submission action |
| Payments | Read-only | No payment or proof upload |
| Messages | Read-only | No send action |
| Notifications | Feature-gated | Production flags/runtime not proved |
| Team | Shape exists | Current Platform RPC can return no contacts |
| Profile | Read-only | Logout only; no self-service edit |

## Priority gaps

| Priority | Gap | Closure |
| --- | --- | --- |
| P0 | Protected document upload/resubmission | Slot-bound private upload, validation, immutable version and real Storage RLS E2E |
| P0 | Team contact projection | Assignment-derived safe contacts and cross-student denial |
| P0 | Production notification proof | Managed flag/config, real acknowledgement, reconnect and replay proof |
| P0 | Messaging scope unresolved | Keep explicitly read-only or approve a separate audited case-message contract |
| P1 | Profile/security self-service absent | Approved editable fields, reauthentication and audit |
| P1 | Document version history absent | Self-only timeline, current marker and audited download |
| P1 | Application deadline/evidence absent | Source-backed deadline/intake and outcome evidence time |
| P1 | Payment evidence path absent | Decide and implement dedicated Finance-reviewed evidence slot |
| P1 | Visa appointment/evidence timeline absent | Safe appointment and evidence summary |
| P2 | Progress formula opaque | Publish formula/source revision and workstream blockers |

## Acceptance boundary

Use real managed test identities to prove assigned and pending cases,
cross-student denial, a real Storage rework/resubmission, notification
dedupe/reconnect/acknowledgement and equal mobile/desktop security semantics.
No WhatsApp, payment, embassy, university or AI provider success is implied.
