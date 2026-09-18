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
