# P2H — private document Storage

- Status: repository candidate; independent review and exact-head CI pending
- Date: 2026-07-29
- Starting database boundary: migration 045
- Additive migration: 046
- Parent contract: `docs/EVO_PLATFORM_LONG_RUN_PLAN.md`
- Foundation contract: `docs/platform/p2-supabase-foundation.md`

## Purpose and proof boundary

P2H connects the existing immutable document-version metadata to one new
private Supabase Storage bucket. It proves the bucket and object authorization
rules through the real project-local Supabase Storage API with synthetic test
identities and files.

The block does not:

- link or mutate a managed Supabase project;
- change production data, Storage objects or credentials;
- add the root application Supabase/Auth cutover, upload UI or download UI;
- execute or claim a malware-scanner provider;
- enable Platform message attachments;
- change legacy `avatars`, `flow-media` or `chat-media` compatibility;
- define document deletion or retention while DEC-012 remains open;
- prove Storage-object restore, which belongs to P2I.

The root application remains fail-closed until P3 supplies its Supabase SSR and
repository boundary. P2H is a real local platform-foundation proof, not a
frontend or production-provider claim.

## Bucket contract

`supabase/config.toml` declares one new bucket:

| Property | Contract |
| --- | --- |
| Bucket | `platform-documents` |
| Public | `false` |
| Per-object limit | `25MiB` / 26,214,400 bytes |
| MIME allowlist | `application/pdf`, `image/jpeg`, `image/png` |
| Seed source | project-local Supabase CLI declarative bucket configuration |

Original filenames remain protected document metadata. Storage object names are
opaque immutable identifiers and never contain the customer filename, phone,
email or other personal data.

## Reservation-first lifecycle

1. An authenticated Admin, current assigned Curator or activated Student asks
   the database to reserve an upload for an authorized document slot.
2. The transaction creates the next immutable document version and a private
   object binding before bytes are accepted. It does not change the slot's
   status or current-version pointer.
   A same-slot row lock preserves any existing unexpired, unfinalized upload
   target: a fresh competing request receives HTTP 409 and cannot create
   competing metadata.
3. The actor uploads with their own user JWT to the exact reserved bucket and
   object name. The Storage policy permits `INSERT` only while the reservation,
   actor and current authorization remain valid.
4. A service-role-only finalization RPC locks the reservation, version and
   slot, verifies the exact binding and `storage.objects` row, and confirms
   that provider-owned metadata timestamp `created_at` falls inside the
   reservation window. That timestamp is an authorization/lifecycle signal,
   not independent proof that bytes completed, match the declared hash or are
   free of malware.
   Only then does it atomically publish that version as the current submitted
   document. A retry with the same request ID returns the immutable
   finalization receipt without a second audit event. Finalization also rejects
   an approved slot or a version older than the already-published current
   version. A later abandoned reservation does not strand an earlier valid
   object: whichever valid version finalizes first publishes monotonically,
   and an older version cannot roll the pointer backward afterward.
5. No authenticated `UPDATE`, overwrite/upsert, `DELETE`, move or copy policy is
   granted. A resubmission creates a new version and object name.
6. The uploaded version remains unavailable while integrity or malware state is
   pending, inconsistent or rejected.
7. A trusted backend may attest validation only with explicit evidence. P2H
   uses synthetic local evidence to exercise the state machine; that does not
   prove a real malware provider.
8. An authorized actor requests a short-lived audited download grant. The
   database records the existing append-only document-access event before it
   creates an opaque browser grant. A trusted backend consumes that grant once
   and receives the exact object tuple and bounded provider-signing TTL.
   One actor may hold only one live, unconsumed grant for a version; exact
   request replay returns the original grant without writing another row.
9. The trusted backend may ask Storage to sign only that exact consumed object.
   Direct authenticated GET and bucket listing remain denied.

A failed or abandoned upload therefore leaves an explicit pending reservation
for reconciliation without displacing the previously usable current version.
The API and Portal must not render an unfinalized version as a successful
upload.

## Concurrency, input and growth guards

The browser RPCs use the same transactional order: request-ID lock, current
actor resolution, actor-scoped quota lock, authorized target row lock, exact
replay, conflict/rate checks, then append-only metadata and audit writes.
Missing and unauthorized slot/version identifiers both return the same generic
HTTP 403 / SQLSTATE `42501` body, so target existence is not exposed before
object-scope authorization.

Repository defaults are deliberately finite staging safeguards:

- at most 60 upload reservations per actor and organization per rolling hour;
- at most 12 upload reservations per document slot per rolling hour;
- at most 120 download grants per actor and organization per rolling hour;
- one unexpired, unfulfilled upload reservation per slot;
- one unexpired, unconsumed download grant per actor and version.

Fresh conflicts use PostgREST `PT409`; exhausted creation windows use `PT429`.
Malformed or overlong input uses `22023`. Filenames and download purposes are
trimmed, limited to 255 characters and 1,024 UTF-8 bytes at both RPC and table
boundaries. The migration validates those table constraints against historical
rows and aborts rather than silently accepting incompatible evidence.

These thresholds are safe initial controls, not production capacity claims.
P2I/P7 must tune them from sanitized staging telemetry and define archival or
partitioning only after the retention decision is approved; no audit or
document evidence is auto-deleted in P2H.

## Authorization matrix

| Actor | Reserve/upload | Audited sign after verified + clean | Explicit denials |
| --- | --- | --- | --- |
| Admin | Organization-scoped case | Organization-scoped case | Every other organization |
| Current Curator | Currently assigned case | Currently assigned case | Unassigned or reassigned case |
| Activated Student | Own case | Own case | Another student or organization |
| Sales | Denied | Denied | Binary document content before and after handoff |
| Finance | Denied | Denied | Binary document content |
| Pending/non-activated Student | Denied | Denied | Portal is not active |
| Blocked/inactive/stale-token actor | Denied | Denied | Every object operation |
| Anonymous | Denied | Denied | Bucket/object discovery and bytes |

Authorization is evaluated again when the trusted backend consumes the opaque
download grant. A Curator reassignment or profile access-version rotation
therefore invalidates an otherwise unexpired database grant. A signed URL
created by that backend is still a bearer credential until its short expiry; it
must never be logged and cannot be treated as immediately revocable.

## Storage policy boundary

Application SQL does not insert, update or delete provider-owned `storage`
tables. Migration 046 may define bucket-qualified policies and read
provider-owned metadata for a service-only reconciliation inventory.

The new policies are intentionally narrow:

- `INSERT`: exact `platform-documents` reservation and uploader only;
- no browser `SELECT` policy at all: list, direct authenticated GET, public
  GET, browser signing and sign-many stay denied;
- no authenticated update, delete, copy or move capability;
- trusted backend signing happens outside browser RLS only after the
  service-only one-time grant-consumption RPC returns the exact object tuple
  and a TTL of at most 60 seconds.

This follows the official Supabase contracts that a plain upload needs only an
`INSERT` policy, while overwrite/upsert also needs `SELECT` and `UPDATE`.
The absence of a browser `SELECT` policy prevents a signing allowance from
silently authorizing listing or direct reads:

- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Storage helper functions](https://supabase.com/docs/guides/storage/schema/helper-functions)
- [Storage operation names](https://github.com/supabase/storage/blob/master/src/http/routes/operations.ts)
- [Local bucket configuration](https://supabase.com/docs/guides/local-development/cli/config)
- [Private downloads](https://supabase.com/docs/guides/storage/serving/downloads)
- [PostgREST custom HTTP errors](https://docs.postgrest.org/en/v12/references/errors.html#raise-errors-with-http-status-codes)

## Real local evidence gate

`npm run test:supabase:local` starts only the named project-local Supabase
stack, resets all contiguous migrations and explicitly seeds declarative
buckets. Ephemeral local keys are written to a mode-0600 temporary file,
consumed in memory and deleted before requests begin. Logs must never contain
the keys, JWTs, signed URL, object bytes or personal data.

The Storage portion must prove with real synthetic user JWTs:

- private bucket attributes and unchanged legacy bucket contracts;
- small PDF, JPEG and PNG upload to exact live reservations;
- rejection of unsupported MIME, 25 MiB + 1 byte and an unreserved path;
- acceptance of the exact 25 MiB boundary;
- anonymous/public/list/direct-GET denial;
- immutable same-path overwrite/upsert denial;
- reservation without slot publication, object-backed service finalization,
  exact replay with one audit, and an abandoned newer reservation preserving
  the prior current version;
- missing, late, wrong-organization and out-of-order finalization denial;
- sign denial before verified integrity and clean malware state;
- local backend byte-size and SHA-256 comparison;
- audited single-object sign and signed-byte hash after synthetic attestation;
- cross-organization, cross-student, unrelated/former Curator, Sales, Finance,
  blocked, pending-Portal and stale-token denial;
- exact request replay without a second grant/access event, and mismatch
  rejection;
- exact generic denial parity for absent and unauthorized slot/version IDs;
- overlong filename/purpose rejection with no metadata or audit side effects;
- competing same-slot upload and duplicate live-grant rejection with the
  original upload/grant remaining usable;
- expired reservation/grant denial;
- redacted metadata/object backup inventory including missing, unbound and
  metadata-mismatch state.

Service keys are allowed only for synthetic setup, exact upload finalization,
trusted validation and the server signing step. Because service keys bypass
RLS, they never count as browser authorization proof.

## Security remediation evidence

The current candidate preserves every validated finding from the P2H security
reviews. A failed later report seal is not treated as clean proof; closure rests
on the code invariant plus the named focused mutation or negative test.

| Finding | Validated risk | Current invariant and focused regression proof |
| --- | --- | --- |
| `csf_201e86d23ebf8889e6a89d73` (Medium) | A later same-case reservation could invalidate another actor's live upload target. | The slot lock permits only one unexpired, unfinalized reservation. Exact replay returns the original tuple; a fresh competing request returns `PT409` with zero row, pointer or audit delta. |
| `csf_94ffa81289f0f3b17cb27b2b` (Low) | Fresh request IDs and unbounded filenames could amplify immutable upload rows. | Filename length is bounded before authorization or writes; actor and slot hourly limits are serialized by advisory/row locks. Overlong and competing requests prove zero side effects. |
| `csf_823f403ba2dfa6083ce23c06` (Low) | Fresh request IDs and unbounded purpose text could amplify durable download-grant rows. | Purpose length, one live actor/version grant and an actor hourly limit are enforced transactionally. Replay, mismatch, live-conflict and overlong-purpose tests assert exact row counts. |
| `csf_2b8cb37a5b16c8d8427ab650` (Low) | Download state was observable before current object authorization. | The JWT actor and authorized case/version join run before integrity, malware, binding or object probes. Missing and unauthorized UUIDs must return the same `42501` state/message and leave no durable state. |
| `csf_574ebbae5a8fcd3130f61554` (Low) | Slot existence was observable before current object authorization. | The JWT actor is established first and the slot is resolved only through an authorized case join. Missing and unauthorized slot UUIDs must return the same `42501` state/message and leave no durable state. |
| `csf_52918acea08de050d811dd9b` (Low) | An objectless reservation could displace the published current document. | Reservation no longer publishes the slot pointer. Service-only finalization verifies the exact object and advances the pointer monotonically; an abandoned newer reservation cannot displace or roll back the valid version. |
| `csf_ba7a7773fc166aba6b578c91` (Low) | Download grant and review could lock the same case/version in opposite order. | All mutable document workflows use actor/authorization, case, optional slot, then version order. Static definition mutations and a real local blocked-transaction barrier fail if the order drifts. |
| `csf_32f88d20ac9da0135a657ae1` (Low) | An UPDATE-denial test could pass after touching zero RLS-visible rows. | Authenticated UPDATE and DELETE probes convert zero-row results to `42501`, require the exact state independently, and prove object existence/count remain unchanged. |
| `csf_b3629109d1c672d6f24b2c11` (Low) | Client-side `Promise.all` outcomes did not prove database overlap. | Client contention is labelled only as business-outcome coverage. A separate local barrier holds the organization authorization row, observes the real grant wait and absence of later case/version locks, then proves the version remains independently lockable. |
| `csf_8e71721b6615f02bfc38ef2a` (Low) | The oversize probe could succeed on an unrelated live-reservation conflict. | The probe uses a clean slot, requires HTTP `400`, SQLSTATE `22023` and the exact safe message, proves zero request-specific rows, then reserves the exact 25 MiB boundary on the same slot. |
| `csf_3e786777aa4d68175467db68` (Low) | A broader Admin Storage SELECT policy could evade the inventory gate. | The inventory requires the exact name, command, roles, permissiveness and normalized expressions of all twelve legitimate policies. A deliberately broadened Admin policy must fail and rollback cleanly. |
| `csf_e1e939bbe05aaf1cffbe58fb` (Low) | Private-ledger ACL checks omitted privileged writes. | The matrix checks five principals, seven privileges and five private tables. Independent `service_role` and `supabase_auth_admin` INSERT/UPDATE/DELETE/TRUNCATE mutations must each fail and rollback. |

The focused proof lives in
`supabase/tests/platform_document_storage_rls.sql`,
`supabase/tests/platform_document_storage_inventory.sql`,
`scripts/test-postgres-authorization.sh` and
`scripts/test-p2h-storage-api.mjs`. It proves the local synthetic
PostgreSQL/Auth/PostgREST/Storage boundary only. It does not prove managed
Supabase, production traffic, malware scanning or backup/restore.

## Backup and recovery boundary

Database backup or PITR does not include Storage object bytes. P2H produces a
redacted object inventory that can detect missing or inconsistent objects; it
does not claim a recoverable backup.

P2I must separately copy the synthetic objects to an isolated target, restore
them and compare object hashes before the Storage backup/restore requirement is
closed.

## Evidence to freeze before merge

The PR evidence must record:

- exact migration 046 byte count and SHA-256;
- disposable PostgreSQL RLS/inventory results;
- real local Supabase reset and Storage API result;
- root, Inbox and retained Lead Agent full gates;
- exact-head `EVO platform CI` jobs;
- independent SHA-bound reviewer verdict;
- `real-provider-proof: not-required`, with real local Supabase service proof
  stated separately from managed-production/provider proof.
