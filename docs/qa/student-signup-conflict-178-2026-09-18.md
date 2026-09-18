# Student signup conflict retry correction — 2026-09-18

Production baseline: `1de14c0ad02b97b5b576060864574ee70e9e8508` (177).
Patch base: `0e49508bfb6d951f3f1794e7ae3fff20410668e4`.

The owner-reported final submit reached `student_application_identity_conflict`.
Production PostgreSQL logs recorded 5,464 SQLSTATE 40001 events in one backend
from 12:20:16Z through 12:25:44Z. The account already had a membership and no
public application. No account identifiers or questionnaire content are included.
The existing authenticated Student portal opened independently.

[Supabase's official retry advisory](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)
explains why a terminal business conflict must not use retryable SQLSTATE 40001.
Forward178 changes only eight explicit business error codes to PT409 in the two
existing functions. No Auth configuration, role, RLS, application row or receipt
is changed by the migration.

## Executed evidence

- Actual production rollback compilation replaced both functions inside one
  transaction, verified unchanged OIDs, owner, ACL, SECURITY DEFINER and search_path,
  compared complete definitions allowing only the four code substitutions in each,
  then rolled back. No production schema update is claimed by this check.
- Existing authorized isolated QA stack on OrbStack: applied exact178 source,
  signed in through real Auth with the already-approved QA Student, and called the
  real REST RPC using a fresh request ID with its existing questionnaire. HTTP409,
  PT409, 23 ms. This exercises approved-application conflict, not the distinct
  production identity-conflict branch. Full application/receipt/membership/case
  snapshots were unchanged. No new identities were created.
- A bounded production activity read subsequently found no matching active submit
  backend. A guarded termination request matched no backend; no process termination
  or service restart is claimed.
- CI binds this receipt to SQL source; it does not execute or relabel these database
  checks as CI proof. Browser and deployment verification remain separate.

```json
{
  "migrationSha256": "8d0abbaafb20cdb34c123fbe08aac90969e5b06234b893e16322cd6158e9da0c",
  "localAuthenticatedRpc": {
    "status": 409,
    "code": "PT409",
    "guard": "approved_application_conflict",
    "elapsedMs": 23,
    "stateUnchanged": true
  },
  "reusedExistingQa": true,
  "newIdentities": 0,
  "productionRollbackCompile": {
    "functions": 2,
    "authorityUnchanged": true,
    "onlyCodesChanged": true
  }
}
```

## Follow-up execution

PR #841 reviewed at `7d1a8c1f659802ee4ac2414a79e7515e4944f715` and merged as
`0156d965ec1e320325f0d61d55380ca7b360287b`. Protected fast checks `35345373299` passed
(Build, Lint, Migration boundary, Release contracts, Fast checks).
Independent read-only review approved all 11 files with no blocking findings.
Targeted existing action tests 15/15 passed; these supplement actual runtime proof.

Before release, the same source ran against the existing isolated QA backend:
normal Auth login → GET /apply → 307 /portal; GET /apply/status → 307 /portal; portal 200
with its actual Student content. Nine-step browser journey → duplicate existing QA
email rejection; direct screenshot verified names, phone, email and consent stayed
populated and password cleared. No new identity or application was created.
DOM extraction masked email/tel values; screenshot was the authoritative visible
check, avoiding an incorrect inference of empty fields.

Exact merged 178 applied once while disarmed, and the complete 001–178 ledger plus
stored source SHA256 matched `8d0abbaafb20cdb34c123fbe08aac90969e5b06234b893e16322cd6158e9da0c`.
The migration has no durable business-data writes. No Auth configuration or
mail-provider configuration changed.

Upstream `35345714588` and downstream `35345749947` both passed. The exact revision
was accepted; independent server readback matched the running revision and image,
healthy with zero restarts, no pending release, and release arm=false. Public
`/api/health` returned 200/live. Acceptance/browser receipt hashes matched.

Actual production Chrome session: /apply and /apply/status both navigated to
/portal and displayed the existing Student workspace. The owner's original
failing tab was then reloaded and redirected to the same portal. No repeat
application was submitted. This proves the existing-account correction; it is
not a new production Student signup or Admissions business-acceptance claim.


Release provenance:

- releaseId: `v3-r35345749947-a1-0156d965`
- revision: `0156d965ec1e320325f0d61d55380ca7b360287b`
- artifactId: `10545769615`
- artifactDigest: `sha256:670484829bc0c6df86aaa788f1b0265fce6775892ae853ebd73692ff4e005157`
- imageId: `sha256:5c2153472a4c9a5a71393d7e16ed8315efa863d9434c2e458ab42972b8bbf161`
- acceptanceRecordSha256: `7c855d9e154748b43e0bab53fef1716bcf2aa0a1ba8ab2e472e00a4bd4b534a7`
- browserReceiptSha256: `43f5a05d257f854c12605256c712ce6c3f28e957458cdcd63df8eafaa0f98436`
