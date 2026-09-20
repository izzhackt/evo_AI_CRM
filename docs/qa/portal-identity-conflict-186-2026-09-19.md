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

## Post-apply evidence — CPU recovered

PR [#858](https://github.com/izzhackt/evo_AI_CRM/pull/858) received independent
review at exact head `cbe1a9264eab410dab4bdb5ccecbdbe958f8d8fc`; protected short
CI [35416723820](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35416723820)
passed. It merged as `b10034b1d93b89dfc520ef89c1ae182e64080938`.

At `2026-09-19T02:50:21.839Z`, exact migration 186 was applied once. Its source
SHA256 remained `beed1ce56a18fceb16c4b6225c088b2599fbb59fd89739eaa5987ace32a6fadf`.
Readback confirmed the exact contiguous 001–186 ledger, zero remaining custom
`40001` codes in the two changed functions, three `PT409` sites in the resolver
and two in its acceptance helper.

At `02:50:36.556Z`, the termination command guarded by the two approved backend
identities matched zero rows. A fresh read also found zero original backends.
No backend was actually terminated; no project restart was performed. Their
disappearance does not by itself prove that the overall error storm or CPU
load has recovered.

At `02:50:56.992Z`, the real PostgREST RPC returned HTTP 409 with `PT409` /
`portal_identity_conflict` in 831 ms using an existing staff identity without a
Student invite receipt and the authorized service-role call. A fresh real
Supabase client through the imported application store returned `mismatch`.
Hashes of all receipt rows were unchanged; no identities or business records
were created. This proves the real negative RPC and server mapping. It is not
a new Student signup; application release acceptance is recorded below.

Exporter CPU counter deltas measured 98.7741157557% during the pre-apply interval
`02:45:48.978–02:47:15.595 UTC`, falling to 1.85462623334% during
`02:51:06.842–02:52:46.080 UTC` after the fix. Initial post-apply metric responses
were cached; the recovery calculation uses fresh positive counter deltas only
(total counter delta `193.569999998`), not repeated cached samples.
The log window `02:50:30–02:52:03.192 UTC`, filtered to
`event_message = 'portal_identity_conflict'`, contains exactly two `PT409`
events from the real HTTP and store checks, and no `40001` for this conflict.
Other functions were not measured by this query. This demonstrates CPU and
this incident's error-storm recovery in the measured window.

## Accepted application release

Exact-main upstream
[35416851038](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35416851038)
and managed release
[35416869712](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35416869712)
both passed. Fresh VPS readback confirmed:

- Accepted release: `v3-r35416869712-a1-b10034b1`.
- Revision: `b10034b1d93b89dfc520ef89c1ae182e64080938`; current main matched at
  acceptance.
- Running image: `sha256:caff496ee4261109256e7239623d244d395606b887555ba2acf3841dfc3af0ef`.
- Acceptance record SHA256: `61365f843c36e241fd88e0c13f9a965b13df4ee8b30991c42e1bfd63ee19faca`.
- Browser receipt SHA256: `c22bb4ab8c96a2e13321e2b706c807b815bd9354d22b8e4fc5ac8bee61058f2c`.

Both receipt hashes matched the actual files beneath
`/opt/evo-crm/release-evidence/v3-r35416869712-a1-b10034b1/`.
The browser receipt is `passed` and covers authenticated read-only case and
Student Portal smoke. Controller and Docker readback agree: app healthy with
zero restarts, scanner healthy. `pending-current.json` is absent; public
health returned HTTP 200 with `ok:true` and `status:live`.

After the workflow reached its terminal state, the operator manually reset
`EVO_PRODUCTION_RELEASE_ARMED=false` and verified a fresh GitHub readback.
This was an explicit operator action, not an automatic workflow reset.
The incident is resolved and released; CPU/error-rate claims retain the exact
measured windows above.

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
