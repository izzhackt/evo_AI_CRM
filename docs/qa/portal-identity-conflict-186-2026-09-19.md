# Portal identity retry incident — 2026-09-19

Patch base: `5f9c90dd8b4b5d9591e783c90ac208d5a837fcb1`.
Production app baseline: `9cdea7aa6f55ae6e6c61286ef339ff311c10a686`.
CPU was 99–100%; logs contained 29,894 `portal_identity_conflict` / SQLSTATE40001
events between 02:21 and 02:26 UTC, correlated to two PostgREST14.5 backends.
No new failing pre-fix HTTP request was issued.

[Supabase's retry advisory](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b)
identifies custom40001 as an infinite transaction retry trigger. Migration186
changes only five explicit business error codes to PT409: three in
`resolve_student_portal_invite_identity` and two in its reachable
`accept_student_portal_invite_e1` helper. Other invite RPCs are outside this patch;
the application retains legacy40001 handling for them during the transition.

## Executed preflight

At 02:43:44Z, the exact migration body compiled in a real production transaction
with a 3-second lock timeout and 12-second statement timeout, then rolled back.
SQL assertions compared entire definitions allowing only the specified code
substitutions, and unchanged OIDs, owners, ACLs, SECURITY DEFINER and search_path.
An existing authorized staff identity with no Student invite receipt exercised
the actual missing-receipt branch: PT409 / portal_identity_conflict. All receipt
rows were hash-identical before and after the call. No identity or business row
was created. A separate fresh read confirmed both definitions and metadata were
restored after rollback.

This SQL preflight ran via Management API, not through PostgREST or browser Auth.
HTTP conflict behavior, store mapping, CPU recovery and managed app release are
separate post-apply checks; they are not claimed by the preflight or CI binding.
ESLint of the changed store, syntax check of the updated existing assertion file,
and `git diff --check` passed. No mock test suite or blanket migration suite ran.

```json
{
  "observedAt": "2026-09-19T02:43:44.830Z",
  "migrationSha256": "beed1ce56a18fceb16c4b6225c088b2599fbb59fd89739eaa5987ace32a6fadf",
  "productionRollbackCompile": {
    "functions": 2,
    "authorityUnchanged": true,
    "onlyCodesChanged": true,
    "rolledBack": true,
    "readbackRestored": true
  },
  "productionSqlConflict": {
    "code": "PT409",
    "message": "portal_identity_conflict",
    "existingIdentity": true,
    "stateUnchanged": true
  }
}
```

## Release and recovery contract

Review exact head, pass protected short checks, merge, apply exact186 once with
the contiguous ledger, and run the managed lightweight release. Freshly match
each approved loop by PID, backend start and PostgREST identity before termination;
do not terminate unrelated sessions or restart the whole project. Prove the real
HTTP conflict and application mapping, existing staff/Student entry, error-rate
and CPU recovery, and exact accepted image/health/pending/arm readback.

Application rollback remains available. Do not reverse the SQLSTATE fix on
PostgREST14: restoring40001 would restore the outage; use a reviewed forward
correction if needed. No compute purchase or Auth policy change is authorized.
