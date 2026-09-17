# Lightweight production release — 18 September 2026 (Dubai)

The owner approved build + short real changed-function smoke + rollback, with
no blanket heavy suite. PR821 implements that contract; its retained upstream
workflow name is not a claim of historical full-suite coverage.

## Changes and immutable proof

- Case opening without a Sales handoff: [PR819](https://github.com/izzhackt/evo_AI_CRM/pull/819).
- Student portal workspace UX: [PR820](https://github.com/izzhackt/evo_AI_CRM/pull/820).
- Lightweight release automation: [PR821](https://github.com/izzhackt/evo_AI_CRM/pull/821),
  independently approved at`acccd729bc18862063e956e9968345b70c65c255`.
- Production revision:`ac04c8e38de7b27aadc1c926db40f65007b3c593`.
- [Light exact-main CI35276171822](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35276171822): success;
  admission5s, Main CRM9s, no dependency installation or full suite.
- [Managed release35276212272](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35276212272): success;
  one immutable image build, read-only ledger comparison, deployment and acceptance.
- Release ID:`v3-r35276212272-a1-ac04c8e3`.
- Image:`sha256:f6ad16e55e8d4408f43afb53a8cbe71164db561f3216ac8ae621913f28604349`.
- Acceptance-record SHA256:`135d986c5bebc065f50c5bdacfa35be2764aca42c5ab3496f3ea38e9fd4b2b14`.

## Short actual production check

The normal Admin and existing owner-approved persistent QA Student logged in
through real Supabase Auth. No new account/case or business data was created.
From21:25:46 to21:26:08 UTC (22s), the release browser proved:

- Admin dashboard, role and exact release metadata.
- The existing case route and contract: HTTP200, actual workspaces and matching
  case identity, no browser runtime errors.
- An isolated Student login, own portal overview/documents and navigation back
  through the sidebar, no browser runtime errors.

The receipt was written only after both paths passed. Failure would trigger the
existing pending-candidate rollback; rollback was not exercised or needed here.
Previous-image rollback information remains preserved.

Final readback: app healthy, zero restarts, running image/revision and accepted
pointer agree; no pending candidate; `EVO_PRODUCTION_RELEASE_ARMED=false`.
Both`https://crm.evoadmissions.com/api/health` and
`https://app.evoadmissions.com/api/health` returned200 with normal TLS.

## Boundaries and next work

This is real technical QA acceptance, not a claim of real-client business
completion. The approved QA document list is empty; populated upload/progress,
full form-to-ZIP history, employee invitations and external providers were not
retested. No database migrations, WAHA/amoCRM/Gemini activation, client messages,
password resets or new backup were performed.

Next business work is employee accounts/roles and actual Sales/Admissions
onboarding. Keep these separate from this completed release; do not rerun the
heavy historical CI to release an ordinary bounded change.
