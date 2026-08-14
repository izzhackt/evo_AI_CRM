# P8 Controlled Release Candidate Contract

Status: docs-only contract proposed under issue
[#175](https://github.com/izzhackt/evo_AI_CRM/issues/175).

Block-ID: `EVO-P8-CONTROLLED-RELEASE-CANDIDATE-2026-08-14`.

## What P8 means

P8 creates one exact EVO Platform release candidate and a truthful evidence
report. A release candidate is not a deployment and is not proof that the
Platform is live. It is the one reviewed version that could later be deployed
without rebuilding different code.

The candidate is identified by all of the following:

- the exact reviewed Git commit and reviewed `origin/main` base;
- the contiguous Supabase migration range and SHA-256 of every migration;
- immutable application image digests for Main CRM, EVO Inbox and EVO Lead
  Agent, built from that commit;
- SHA-256 values for the production Compose, Caddy and safe environment-example
  files used to describe the deployment;
- the names, presence and ownership of required runtime settings, never their
  secret values;
- the exact validation commands, exit codes, test counts and resulting evidence
  artifact hashes.

Changing any item creates a different candidate and invalidates evidence bound
to the previous one.

## Plain-language boundary

P8 preparation may build and inspect the candidate. It may read current
production topology, versions and health without reading customer content. It
must stop before any action that changes production or an external provider.

Separate action-time owner approval is required before:

- deploying an image or changing production configuration;
- applying a managed Supabase migration;
- changing DNS, Caddy routing, WAHA session, webhook or QR settings;
- sending a WhatsApp message or enabling autonomous send;
- calling Gemini with customer content;
- writing to amoCRM;
- creating a billed provider resource or accessing customer records for proof.

Lead Agent, the legacy webhook/session path and rollback path stay deployed and
must not be removed in P8.

## Candidate evidence model

P8B will add a deterministic repository-owned command that writes a report
under an ignored evidence directory. The report must contain only safe metadata
and use this closed result vocabulary for every segment:

- `verified` - the exact candidate completed the named real check;
- `blocked` - a required credential, authority, identity, environment or
  service is unavailable;
- `deferred` - the owner explicitly postponed the segment;
- `not_applicable` - the frozen candidate scope does not contain the segment.

The report must never contain secret values, tokens, cookies, personal data,
WhatsApp content, provider payloads, database rows or Storage object bytes.
Every `verified` result requires a timestamp, candidate commit, command or
provider operation, exit/status result and SHA-256 of its separately retained
redacted evidence. A statement without that evidence cannot be `verified`.

## Ordered P8 blocks

### P8A - contract and baseline

Merge this contract after independent review and green exact-head CI. Record
the exact current GitHub baseline, known production gap and unavailable
provider/release decisions. P8A changes no runtime.

### P8B - deterministic candidate manifest

Implement the manifest/report command, closed schema and redaction tests. Build
the three production application images once on OrbStack from the exact commit
and record their immutable digests. A rebuild with a different digest is a new
candidate unless the build is independently proved reproducible.

P8B may use repository files and real build tools, but fixture or mocked
provider success cannot populate a `verified` real-service result.

### P8C - non-mutating environment reconciliation

Compare the candidate requirements with GitHub, `hermes-vps`, managed
`evo-platform-prod`, WAHA, amoCRM and Gemini using only authorized read-only
operations. Record versions, setting names, network ownership, migration drift
and health without copying secrets or customer data. Missing access is
`blocked`; it is never replaced by a local stand-in.

### P8D - approval-gated disabled deployment

Only after separate owner approval, deploy the exact candidate with Platform
provider-write and autonomous-send flags disabled. Apply only the reviewed
forward migrations, keep Lead Agent and the legacy path available, run health
and rollback prechecks, and record the deployed immutable digests. Any drift,
failed migration, unknown session ownership or rollback loss stops the block.

### P8E - accessibility on the exact candidate

Run the retained automated accessibility suite against the exact deployed
candidate, then guide the owner through the focused human matrix defined in
`docs/platform/p7d-focused-accessibility-contract.md`. Fix release-blocking
findings and repeat both affected checks on the new candidate. This is focused
release evidence, not a formal WCAG conformance claim.

### P8F - real-service accounting and release decision

Account for the P4R/P5-P7 scope and the narrowed path:

`WhatsApp receive/history/media -> Platform persistence -> identity/context read -> structured AI proposal -> deterministic policy or durable human handoff -> ACK/delivery/read/unknown -> audit`.

Each segment is `verified`, `blocked`, `deferred` or `not_applicable`. P4R is
read-only; P4B activation and amoCRM writes stay deferred. Autonomous send
requires its own later approval. P8F produces a release recommendation but does
not release by itself. P10 follows this accounting; P9 remains removed.

## Stop conditions

Stop the current block and preserve evidence when any of these occurs:

- candidate commit, base, image digest, migration hash or configuration hash
  changes;
- a required check is red, missing or bound to another commit;
- production differs from the reviewed topology in a way not covered by the
  rollback plan;
- a requested read would expose customer content or a secret;
- an external mutation lacks fresh owner approval;
- accessibility finds a critical workflow, keyboard, focus, screen-reader,
  mobile, security or privacy defect;
- the legacy rollback path is unavailable;
- a missing real service would need a mock, synthetic substitute or relabelled
  local result to appear successful.

## Acceptance

P8 is complete only when:

1. one exact candidate manifest and redacted evidence index exist;
2. repository, image, migration and configuration identities match;
3. applicable CI and security gates are green on that exact commit;
4. the automated and human accessibility gates are complete on that exact
   deployed candidate, or release is explicitly blocked;
5. every real provider and production segment is honestly classified;
6. freeze and rollback artifacts are executable and retain Lead Agent plus the
   legacy path;
7. an independent exact-head review, exact-head CI, exact-base recheck, reviewed
   merge and exact-main push CI are recorded.

P7C managed recovery and the large P7D load test remain owner-deferred. P8 must
not claim recovery, RPO/RTO, high-load capacity or formal WCAG conformance.

## Official basis

- Next.js self-hosting and deployment consistency:
  <https://nextjs.org/docs/app/guides/self-hosting>
- Playwright accessibility testing with Axe and the limits of automated checks:
  <https://playwright.dev/docs/accessibility-testing>
- W3C WCAG 2.2 conformance and complete-process requirements:
  <https://www.w3.org/WAI/WCAG22/Understanding/conformance.html>
- Supabase database migration workflow:
  <https://supabase.com/docs/guides/deployment/database-migrations>
