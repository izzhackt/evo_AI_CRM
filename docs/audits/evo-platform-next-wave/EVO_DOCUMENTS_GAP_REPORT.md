# EVO Documents gap report

Status: evidence-backed audit draft; no runtime or production change
Baseline: origin/main d243b2bb370d052750278e7f5cc2625991d5f870, 2026-08-17

## Boundary

Platform owns ordinary requirements, private files, versions, validation,
review/rework and audited access. ADR 0017 keeps document reading, extraction,
Student Profile autofill and form export in the separate system.

## Foundation and gaps

| Area | Present | Missing |
| --- | --- | --- |
| Checklist | Versioned country requirements and slots | Unified author/apply/rebase operator flow |
| Metadata | Requirements, slots, versions, validation/review/access events | Complete connected UI |
| Storage | Reservation/finalization and one-time download contract | Portal upload, staff preview and managed proof |
| Validation | Type/size/integrity/malware states | Real scanner worker/reconciliation |
| Review | Approve/correction/reject contract | Full current-version UI and history |
| Notification | Safe negative-review producer behind flag | Production runtime proof |
| Restore | Storage inventory contract | Isolated DB plus object restore proof |

Critical split: global staff documents routes still use legacy queries/actions,
the Platform review path is embedded in Student 360, and Portal upload is
explicitly unavailable. The schema is ahead of the product path.

## Priority gaps

| Priority | Gap | Closure |
| --- | --- | --- |
| P0 | Student upload/resubmit absent | Private slot reservation, upload progress/retry and finalization |
| P0 | Staff queue legacy | Supabase-native scoped queue/detail |
| P0 | Scanner not connected | Idempotent worker, timeout/unknown/malware states and reconciliation |
| P0 | Managed Storage/RLS unproved | Cross-student/role denial and expiring download proof |
| P0 | Restore unproved | Checksum-identical DB plus Storage isolated restore |
| P1 | Version history hidden | Current/previous versions and audited download |
| P1 | Review UI narrow | Full approve/correct/reject with stale-version protection |
| P1 | Retention/legal hold unresolved | Approved retention/deletion/hold policy |

## Minimum slices

1. Replace legacy staff read path.
2. Connect Portal reservation/upload/finalization.
3. Connect real validation/scanner worker.
4. Complete review, notification and resubmission.
5. Connect audited preview/download and restore drill.

Unsupported type, wrong scope, scanner unknown/failure, preview failure and a
stale review must never become success. Production-ready status requires
managed Storage and real worker proof, not repository tests alone.
