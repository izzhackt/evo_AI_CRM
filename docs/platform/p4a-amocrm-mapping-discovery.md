# P4A amoCRM mapping discovery boundary

Status: candidate local-only implementation evidence
Block-ID: `EVO-P4A-AMOCRM-MAPPING-DISCOVERY-2026-08-04`
Baseline: `45e64f7b6bfb181a065ae7cfc34abd0fb1b693ec`

## Outcome

P4A creates the first bounded seam of the approved canonical amoCRM adapter.
It can normalize account-specific pipelines, statuses, active users and
lead/contact custom-field definitions into a deterministic sanitized snapshot,
then persist that snapshot as an immutable organization/account version in
Supabase.

This is not a configured or working amoCRM integration. The repository has no
amoCRM credential, OAuth refresh store, provider route or scheduled discovery
job in this block. No provider was contacted and no amoCRM contact, lead,
responsible user or stage was read or changed during local validation.

## Official provider contract used

The server-only client permits exactly these HTTPS `GET` operations against one
validated `<subdomain>.amocrm.ru` or `<subdomain>.kommo.com` origin:

1. `GET /api/v4/account`
2. `GET /api/v4/leads/pipelines`
3. `GET /api/v4/users?limit=250&page=N`
4. `GET /api/v4/leads/custom_fields?limit=250&page=N`
5. `GET /api/v4/contacts/custom_fields?limit=250&page=N`

The implementation follows the provider's HAL collection envelopes, reads user
activity from `rights.is_active`, accepts current top-level custom-field enum
metadata and handles provider field type as a defensively normalized opaque
value. It reconstructs each next page on the already validated origin instead
of following a provider-supplied URL. Requests are sequential, bounded, have a
timeout and response-size limit, use no cache, reject redirects and do not
retry automatically.

Primary references:

- [Kommo account parameters](https://developers.kommo.com/reference/account-parameters)
- [Kommo pipelines list](https://developers.kommo.com/reference/pipelines-list)
- [Kommo users list](https://developers.kommo.com/reference/users-list)
- [Kommo custom fields list](https://developers.kommo.com/reference/custom-field-by-entity)
- [Kommo API limitations](https://developers.kommo.com/docs/limitations)
- [amoCRM pipelines and statuses](https://www.amocrm.ru/developers/content/crm_platform/leads_pipelines)

## Persisted data contract

Migration 058 owns one private table:
`platform_private.amocrm_mapping_discovery_versions`.

Each row contains:

- Platform `organization_id` and discovered amoCRM account ID/domain;
- an account-local sequential version;
- one schema-versioned sanitized snapshot;
- database-computed SHA-256;
- `local_non_provider` or `provider_observed` evidence classification plus a
  bounded evidence reference;
- replay-safe request ID and timestamps.

The snapshot selects only mapping metadata. Recursive validation rejects keys
associated with access/refresh tokens, client secrets, authorization headers,
passwords, email, phone, raw/payload bodies, customer data and message data.
Provider extras are not persisted. Rows are append-only and cannot be updated,
deleted or truncated.

`provider_observed` is evidence metadata supplied by the trusted caller; the
database does not turn that label into provider proof. A release claim still
requires the actual sanitized request/response evidence and controlled account.

## Authorization contract

- `platform.persist_amocrm_mapping_discovery(...)` is executable only by the
  Supabase `service_role` and also verifies the live JWT role inside the
  security-definer function.
- `platform.admin_amocrm_mapping_discovery_versions(...)` is executable only by
  authenticated sessions and then requires current, non-stale, same-org Admin
  authority and organization scope.
- `anon`, browser-authenticated non-Admin, cross-organization Admin, inactive or
  stale authority, Auth Admin and direct table access fail closed.
- No service-role key or amoCRM access token is created or read by the browser.

## Existing frontend boundary

The accepted root frontend from PRs #64/#71/#72 remains the only product UI.
BW7 already connected its Student 360/Portal/Sales-summary product workflow to
greenfield Supabase. P4A does not add a parallel settings UI and does not alter
those screens. Existing Platform conversation records already carry
`amocrm_account_id`, `amocrm_lead_id` and `amocrm_contact_id`; later P4 slices
must connect read-only identity/context sync and a reviewed mapping-selection
workflow behind those existing repository seams.

Still missing before prototype interactions become a real amoCRM path:

- server-side OAuth/secret custody and rotation;
- authorized discovery against the exact controlled account;
- explicit selection/approval of the discovered pipeline, contract status,
  responsible-user and required custom-field mappings;
- read-only identity/context sync and conflict rules;
- persist-first webhook inbox, idempotency, outbox/jobs and reconciliation;
- guarded canonical writes and a sanitized test lead;
- real provider, staging and production evidence.

## Validation and evidence boundary

Required candidate checks are:

```text
node --experimental-strip-types --test tests/platform-amocrm-discovery.test.mjs
npm run test:security:postgres
npm run test:supabase:local
npm run test:security
npm run test:unit
npm run lint
tsc --noEmit
npm run build
```

The candidate passed disposable PostgreSQL authorization and the complete
OrbStack local gate: 58 contiguous migrations, real local Auth/PostgREST,
private Storage, PGMQ and 28/28 accepted-frontend browser scenarios. Exact
project containers and volumes were removed by the harness after exit 0.

Exact candidate results on 2026-08-04:

| Gate | Result |
| --- | --- |
| Focused P4A contract/client/repository tests | 12/12 passed |
| Root security suite, including disposable PostgreSQL | passed |
| OrbStack Supabase local gate | passed; 58 migrations and 28/28 browser scenarios |
| Root unit tests | 156/156 passed |
| Root lint, typecheck and production build | passed |
| Root Playwright, including accessibility coverage | 89 passed, 55 intentionally skipped |
| Root production and approved-development dependency audits | zero vulnerabilities |
| EVO Inbox lint/typecheck/tests/build/audits | passed; 788/788 tests, zero audit vulnerabilities; seven pre-existing lint warnings |
| Retained Lead Agent Ruff/pytest | passed; 124/124 tests |

The exact-head GitHub CI, independent launch-control review and controller merge
remain pending until this candidate is committed and opened as a PR.

The local test data uses synthetic account IDs, names and domains only. This
green result proves response normalization, immutable/versioned persistence,
PostgreSQL/RLS grants and the real local Supabase Auth/PostgREST boundary. It
does not prove credentials, provider availability, account mapping correctness,
managed Supabase, staging, production or any customer workflow.

## Rollback

Migration 058 is additive and has no active mapping pointer or runtime job.
Runtime rollback is to stop calling the two new RPC adapters. No existing
conversation, admissions or frontend table is rewritten. A database rollback
must preserve immutable evidence according to the later approved retention and
restore policy; this block authorizes no destructive production rollback.
