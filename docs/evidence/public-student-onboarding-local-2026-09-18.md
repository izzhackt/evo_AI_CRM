# Public Student onboarding: scoped local proof

**Historical receipt only.** This proof covers the original draft Student
migration172 before staff migrations173–175. Main172 is now a retired no-op;
the current Student migration177 adds department-scoped review integration.
Neither177 nor its accompanying staff-signup guard has been executed by this
receipt. The JSON and its original paths/hashes remain unchanged. Further
manual/browser/SQL checks were waived by the owner; no new success is claimed.

Recorded on 2026-09-18. The [machine-readable receipt](public-student-onboarding-local-2026-09-18.json) records 35 successful direct Auth/RPC checks and hashes the contemporaneous migration, contract, source adapter and action. The live checks exercise Auth and SQL RPC behavior; they do not execute the Next.js actions or V3 adapters. Those modules have separate isolated unit tests with injected dependencies. The Next.js/browser journey remains unverified. The repository HEAD at the original run alone did not identify the then-uncommitted implementation.

## Environment and boundary

The existing OrbStack invite QA stack was reused. Its migration ledger started at 134 with four existing Auth identities, four memberships and one organization. Existing forward migrations 135–171 were applied once, then migration 172 was compiled in a rolled-back transaction and applied. Later scope-local function corrections were applied and exercised without resetting the database. No staff identity was created, altered or given new permissions.

The expired local gateway setup was repaired while preserving the database and original stopped gateway/Auth containers for rollback. Local Auth uses signup enabled, email autoconfirm disabled, existing Mailpit, and an explicit loopback callback. Existing QA Admin, Sales and a second existing Student authenticated through real email OTP with `shouldCreateUser: false`. One owner-authorized fictional Student registered through canonical Auth signup, received a Mailpit email and confirmed it through Auth.

This is technical proof on local Supabase, not production SMTP delivery, customer acceptance, browser acceptance or deployment evidence. No provider or production state was changed.

## Results

- Confirmed email is required before login/submission. A pending request creates neither membership nor Student case and cannot enter the portal RPC.
- Anonymous callers, pending Students and Sales cannot access the Admissions queue. A second real Student cannot read another applicant's request/case or replay the applicant's submission receipt.
- Submission replay is idempotent; changed payload under the same request ID fails. Rejection followed by a revision-bound resubmission preserves the application identity and multiselect answers.
- Admin chooses an eligible curator and a direction represented in the questionnaire. An unrelated direction fails. Approval creates one membership, one active canonical case and one profile in the same database transaction. Replay does not duplicate the case; a stale conflicting decision fails.
- After a real Auth refresh, the approved Student can read the existing portal RPC. Staff can read the case with a null Sales owner, its profile and section authority. The application page correctly returns an empty list; an actual university application/document workflow was outside this check.
- All original questionnaire arrays remain available as source evidence. Imported profile facts remain `needs_review` with human-readable education, language and budget values. Approval does not create a Sales client or lead.
- Scoped ESLint passed for the three new TypeScript files. The checked-in reproduction script passed `node --check`; the shared diff passed `git diff --check`.

## Reproduction

The original run used draft migration172. A future run of the current source
requires an existing healthy local Supabase with the actual canonical ledger
through177 (retired172, staff173–175, accepted Docs176, Student177); the old QA172 cannot be
relabelled as that environment. No new run is authorized by these instructions.
Use only owner-authorized bounded fictional Student QA with real existing QA
Admin, Sales and another Student, the custom access-token hook enabled, email
signup enabled, autoconfirm enabled and local Mailpit (existing QA sign-in only). This harness does not
set up infrastructure, seed staff or apply migrations; it also does not replace
coverage of the newly added department-manager and protected staff-marker paths.

Create a private directory (mode `0700`) and `qa-config.json` (mode `0600`) outside Git:

```json
{
  "url": "http://127.0.0.1:56915",
  "publishableKey": "LOCAL_ANON_PUBLISHABLE_KEY_FROM_THE_EXISTING_STACK",
  "mailpit": "http://127.0.0.1:56919",
  "dbContainer": "supabase_db_evo-EXISTING-LOCAL-QA-PROJECT",
  "signupRedirectUrl": "http://127.0.0.1:31982/auth/callback?flow=signup"
}
```

Use the actual local container name (lowercase) and ports. The script verifies OrbStack, loopback Auth/Mailpit URLs and the local Supabase container prefix. It refuses to run again in an artifact directory that already contains a Student, so repeated proof cannot silently create duplicate QA identities.

```sh
EVO_LOCAL_QA_DIR=/absolute/private/qa-directory node scripts/prove-public-student-onboarding-local.mjs --allow-local-qa-student
```

The script uses real Auth and RPCs; its direct SQL calls are read-only state/grant evidence, never user impersonation. It writes tokens, sessions and the fictional Student password only to private local files. Do not commit those files or paste their contents into an issue, PR or chat. Console output and `receipt.json` contain check names only. The final approved QA identity remains available for the separate real UI journey; do not remove it without the run's cleanup authority.

The original proof ran in three private checkpointed stages while correcting the migration. The current harness now exercises the owner-selected no-confirmation signup and requires the canonical ledger through177. Its original receipt is still historical; a new real run must record its own source hashes and results. Do not present the old Mailpit-confirmation receipt as no-email proof.

## Review correction

The initial stale-decision check accidentally included approval-only fields with a rejection payload, so it proved input rejection rather than revision conflict. On 2026-09-18 at 00:38:34 UTC the existing approved QA request was exercised once with a valid rejection payload (null direction and curator), a stale revision and a new request ID. The live RPC returned exactly `40001`. The reproduction now asserts that code; the correction is recorded in the JSON receipt. No new identity or state transition was needed.
