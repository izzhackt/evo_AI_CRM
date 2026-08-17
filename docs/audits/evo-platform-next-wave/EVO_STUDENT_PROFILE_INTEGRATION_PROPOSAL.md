# EVO Student Profile integration proposal

Status: design proposal only
Evidence baseline: `origin/main` at `d243b2bb370d052750278e7f5cc2625991d5f870` on 2026-08-17
Issue: [#263](https://github.com/izzhackt/evo_AI_CRM/issues/263)

## Decision boundary

ADR 0017 is authoritative: document reading, extraction, Student Profile
autofill and form export remain in the separate `evo_student_document_system`.
EVO Platform owns the ordinary admissions document lifecycle and must not take
a runtime dependency on that local-first tool without a new approved plan
amendment.

This document defines a possible future integration. It does not authorize a
database migration, document transfer, provider call, shared bucket, shared
database or production deployment.

## Evidence reviewed

| Area | Current evidence | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Platform documents | `supabase/migrations/043_platform_documents_finance_notifications.sql`, `046_platform_private_document_storage.sql`, `055_platform_document_finalization_lock_order.sql` | Version metadata, private-object reservation/finalization, integrity/malware state, review and audit contracts exist in the repository | Managed Storage upload, scanner, backup or production RLS behavior |
| Platform profile | `supabase/migrations/053_platform_student_profile_requirements.sql`, `src/lib/platform-student-profile*.ts` | Bounded operational profile and consent fields exist | OCR-derived fields or generated Profile form |
| Separation | `docs/adr/0017-separate-student-profile-document-automation-from-evo-platform.md` | No automatic exchange or runtime dependency is approved | Any integration implementation |
| Separate tool | `/Users/iskhak.tazhibaev/Documents/01_Projects/evo_student_document_system/README.md` and `server/` | Local-first 14-item checklist, signature/size validation, Gemini extraction, schema validation, deterministic normalization, provenance, conflict review, immutable versions and DOCX export | Multi-user auth, encrypted object storage, malware scanning, backups, retention policy or internet-safe operation |
| Tool tests | `tests/api.test.ts`, `tests/extractor.test.ts`, `tests/normalizers.test.ts`, `tests/docx-template.test.ts` in the separate project | Local deterministic behavior is covered | Real Platform integration or production provider behavior |

## Proposed trust model

The Platform remains the system of record for student identity, authorization,
case ownership, source document references and curator-approved operational
profile fields. The processor is a short-lived worker that receives one
explicitly authorized document job and returns proposals. It never receives
general access to a student, organization or Storage bucket.

```mermaid
sequenceDiagram
  participant C as Curator
  participant P as EVO Platform
  participant S as Private Storage
  participant X as Profile processor
  C->>P: Request extraction for exact document version
  P->>P: Verify role, case scope, purpose and consent
  P->>S: Create one bounded read grant
  P->>X: Signed job + minimal metadata + one-time grant
  X->>S: Read exact version
  X->>X: Extract, normalize and detect conflicts
  X-->>P: Signed proposals with provenance; no approval
  P->>C: Show field-by-field review
  C->>P: Accept, edit or reject each proposal
  P->>P: Write approved fields and immutable audit
  P-->>X: Acknowledge completion/deletion request
```

## Contract objects

### Processing request

```json
{
  "schema_version": 1,
  "job_id": "uuid",
  "organization_id": "uuid",
  "student_case_id": "uuid",
  "document_version_id": "uuid",
  "purpose": "student_profile_field_proposal",
  "consent_evidence_ref": "opaque-reference",
  "requested_field_keys": ["legal_display_name", "date_of_birth"],
  "source": {
    "bucket": "platform-documents",
    "object_grant": "one-time-short-lived-reference",
    "sha256": "hex",
    "mime_type": "application/pdf"
  },
  "requested_by_membership_id": "uuid",
  "requested_at": "RFC3339",
  "expires_at": "RFC3339"
}
```

The processor must reject an expired job, unsupported schema, absent consent,
hash mismatch, unapproved MIME type, or request for a field outside the
allowlist. Object credentials and provider keys must never appear in database
rows, browser responses or logs.

### Extracted-field proposal

```json
{
  "schema_version": 1,
  "job_id": "uuid",
  "processor_run_id": "opaque-id",
  "model_id": "exact-provider-model-id-or-deterministic-parser",
  "source_sha256": "hex",
  "proposals": [
    {
      "field_key": "date_of_birth",
      "raw_value": "redacted-from-log",
      "normalized_value": "YYYY-MM-DD",
      "confidence": 0.0,
      "source_page": 1,
      "source_region": "optional-bounding-reference",
      "state": "proposed",
      "warnings": []
    }
  ],
  "errors": [],
  "completed_at": "RFC3339"
}
```

Allowed proposal states are `proposed`, `needs_review`, `conflict` and
`unavailable`. There is deliberately no `approved` processor state. Approval
belongs to an authorized Curator or Admin inside Platform.

## Platform workflow

1. Curator opens an exact immutable document version in Student 360.
2. Platform verifies `document.download`, organization, case assignment,
   document integrity, malware status, active consent and requested purpose.
3. Platform creates an idempotent processing job and one short-lived read
   authorization. Repeated request IDs return the existing job.
4. A trusted server worker gives the processor only the selected document and
   allowlisted fields.
5. The processor validates bytes, extracts candidates, deletes any Gemini Files
   API upload after the attempt, and returns signed structured output.
6. Platform checks job identity, source hash, schema, signature and field
   allowlist before persisting proposals.
7. Curator reviews the source, proposed value, confidence and conflict beside
   the current Platform value. Existing human-confirmed values are never
   overwritten automatically.
8. Curator accepts, edits or rejects each field. Platform writes the resulting
   operational profile change and immutable audit event with reason and source.
9. Form generation is a second explicit, reviewed action against a fixed
   template version. It is blocked while required fields have unresolved
   conflicts.
10. Platform records completion and applies the approved retention/deletion
    policy to processor artifacts; source document retention remains governed
    separately.

## Security and privacy gates

Before implementation, the owner must approve:

- the precise data classes and legal purpose;
- consent wording, withdrawal behavior and evidence format;
- processor hosting, region, encryption and service-to-service authentication;
- provider DPA and whether each document category may reach Gemini;
- temporary-file and provider-file retention windows;
- incident handling and deletion proof;
- whether generated forms are stored as new Platform document versions.

Required technical controls are mTLS or equivalent workload identity, signed
and expiring job envelopes, one-time object grants, outbound allowlisting,
encrypted queues, PII-free logs, replay protection, per-organization quotas,
malware-clean prerequisite, audit correlation IDs and a kill switch.

## Failure handling

| Failure | Required result |
| --- | --- |
| Missing/withdrawn consent | Reject before any object grant or provider call |
| Unsupported/corrupt file | Keep source unchanged; mark job failed with safe reason |
| Provider unavailable/timeout | No retry beyond bounded policy; no field write; Curator can proceed manually |
| Hash/signature mismatch | Security failure; revoke grant; create audit/alert |
| Low confidence | Store proposal as `needs_review`; never autofill |
| Conflict with confirmed value | Preserve confirmed value and show both sources |
| Partial extraction | Return only sourced fields and explicit missing fields |
| Curator rejects proposal | Preserve immutable rejection reason; do not train automatically |
| Generated form fails | Keep approved profile; no document marked generated |
| Deletion proof unavailable | Mark cleanup incomplete and alert; do not claim deletion |

## Acceptance evidence for a future integration

- synthetic, non-customer documents covering success, low confidence,
  conflict, corruption and hostile filename/signature cases;
- cross-organization and cross-student denial at API and Storage layers;
- proof that expired/replayed grants fail;
- proof that confirmed values cannot be overwritten by processor output;
- audit linkage from request through proposal, human decision and generated
  form version;
- real provider evidence only after approved credentials, DPA/data classes and
  disposable test documents exist;
- deletion evidence for temporary and provider copies;
- restore test for Platform source and generated objects;
- independent security review before any live student document is processed.

## Recommended implementation sequence

1. Plan amendment and privacy decision record; no code.
2. Versioned JSON contract and synthetic contract tests in a neutral package.
3. Platform job/audit tables and read-only UI for proposals.
4. Isolated processor service with local deterministic fixtures.
5. Secure object handoff and failure-injection tests.
6. Curator review/writeback and generated-form versioning.
7. Authorized non-customer provider pilot.
8. Separate production decision and narrow rollout.

Until all eight steps are completed, the current separate local tool must not
be described as integrated with EVO Platform.
