# Platform document validation worker

Status: BW8B implementation runbook. This is not evidence of deployment,
managed Supabase mutation, production activation, or real student-data
processing.

## What this service does

The document-validation worker consumes only persisted
`document_validation` jobs. For each claimed document version it resolves one
finalized private Storage object, downloads at most 25 MiB, verifies exact byte
size and SHA-256, identifies PDF/JPEG/PNG from file magic, and streams the bytes
to private ClamAV with `INSTREAM`. It records `clean` only after an exact real
ClamAV verdict. It never enqueues extraction.

The shared queue remains pointer-only. Unsupported work kinds are filtered in
the service-only claim RPC and are rejected again at the worker boundary. A
declared filename or MIME type can never create a clean result.

## Security and network boundary

- Compose pins the official `clamav/clamav:1.5.3-debian13-slim` patch image.
- `clamd` and the worker share the dedicated EVO-owned
  `evo_crm_document_validation` network. There is no public `ports` mapping.
- The scanner runs as the image's `clamav` user through
  `/init-unprivileged`, with all Linux capabilities dropped and a read-only
  root filesystem. The named `evo_crm_clamav_signatures` volume persists only
  the signature database.
- The worker runs as an unprivileged image user with a read-only root
  filesystem. Its service-role key exists only in a separate ignored server
  env file; it must never enter a browser bundle, log, URL, fixture, or commit.
- ClamAV TCP has no authentication or encryption, so it is confined to the
  private dedicated network. The adapter uses `INSTREAM`; it never sends a
  host path through `SCAN`.

These choices follow the official ClamAV protocol guidance for NUL-framed
commands, four-byte big-endian `INSTREAM` chunks and `StreamMaxLength`, plus
the warning that `clamd` TCP must not be exposed to untrusted networks:
<https://docs.clamav.net/manual/Usage/ClamdProtocol.html>. The official image,
signature-volume, healthcheck, non-root entrypoint and memory guidance are at
<https://docs.clamav.net/manual/Installing/Docker.html>. The exact patch tag is
published by the official image repository:
<https://hub.docker.com/r/clamav/clamav/tags>.

## Required server-only configuration

Create an ignored `.env.platform-document-worker` with:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=REDACTED_SERVER_ONLY_VALUE
EVO_DOCUMENT_VALIDATION_WORKER_ENABLED=false
```

Keep the worker disabled until migration 060 is applied, the real local
Storage/PGMQ/ClamAV acceptance proof passes, exact-head review and CI are
green, and activation is separately authorized. The committed Compose default
is also `false`; both the `student-documents` profile and an explicit `true`
value are required to consume work.

Optional bounded settings are documented in `.env.example`. The Compose
network fixes `EVO_CLAMAV_HOST=evo-document-validation-scanner` and port 3310;
do not replace them with a public address.

## Deterministic local proof

Run the unit contracts first:

```bash
node --conditions=react-server --experimental-strip-types --test \
  tests/platform-clamav-client.test.mjs \
  tests/platform-document-validation-worker.test.mjs
```

Then run the real scanner proof:

```bash
bash scripts/test-platform-clamav-integration.sh
```

The integration harness fails nonzero if Docker or the pinned image is
unavailable. It creates one exact disposable container, binds port 3310 to an
ephemeral `127.0.0.1` host port only, waits for real health/signatures, proves a
synthetic clean file and the standard EICAR anti-malware test file over the
Node adapter, stops that exact container, and proves the unavailable scanner
cannot become clean. Its trap removes only the captured disposable container
ID.

## Production-oriented Compose inspection (no activation)

Rendering the profile requires release metadata and a non-secret path to the
ignored worker env file:

```bash
EVO_RELEASE_REVISION=0000000000000000000000000000000000000000 \
EVO_RELEASE_VERSION=validation-only \
EVO_CRM_DOCUMENT_WORKER_ENV_FILE=.env.platform-document-worker \
docker compose -f docker-compose.prod.yml --profile student-documents config
```

Inspect the rendered result and confirm:

- scanner has `expose: 3310` and no `ports`;
- worker has no exposed or published port;
- both services use only `evo_crm_document_validation`;
- worker activation is still `false`;
- no service-role value appears in rendered output.

Do not run `up`, deploy, or change the production env as part of this
inspection.

## Failure behavior and evidence

| Condition | Durable outcome | Validation attestation |
| --- | --- | --- |
| ClamAV connect/timeout/malformed/daemon error | retry, then existing dead letter budget | none |
| Storage or resolver temporarily unavailable | retry, then existing dead letter budget | none |
| size, SHA-256 or file-magic mismatch | terminal | `failed` / `error` |
| ClamAV stream limit | terminal | `failed` / `error` |
| infected | terminal | `verified` / `infected` |
| exact ClamAV clean verdict | success | `verified` / `clean` |

Attestation and finish request IDs are derived deterministically from the
claimed work/attempt identity. A crash after attestation therefore replays the
same mutation instead of inventing a second outcome. Logs contain only fixed
event/status codes and a hash of scanner version metadata; they contain no
file bytes, object path, filename, student value, provider key, or scanner raw
reply.

## Rollback

Set `EVO_DOCUMENT_VALIDATION_WORKER_ENABLED=false` and stop only the
`document-validation-worker` service. Existing immutable document versions,
validation history, queue attempts and dead letters remain evidence. Do not
delete Storage objects, queue history, attestations, or the signature volume as
an automatic rollback action.
