# Public website edge

Status: implementation candidate; not DNS, TLS or successful inquiry evidence.
Backend contract: merged PR795 and
[website intake](2026-09-16-website-intake.md).

## Routing contract

The existing `evo-edge-caddy` alone owns public80/443. Add
`evoadmissions.com` and `www.evoadmissions.com`, both serving the independent
`evo-website-web:8080` container on `evo_public_web`. Do not change the CRM
hostname, application/Auth origin, WAHA or the separate Inbox service.

Only exact `POST /api/website-leads` reaches `evo-crm-app:3000`, rewritten to
`/api/public/website-leads`. The edge caps the body at8KB, overwrites
`X-EVO-Website-Key` and `X-EVO-Website-IP`, and removes Cookie, Authorization
and Proxy-Authorization. IP comes from `{remote_host}` (the socket peer), not
caller `X-Forwarded-For`. Do not add a CDN/proxy in front without a separate
trusted-proxy review. Other methods return405/Allow:POST; other website API
paths return404. The direct receiver is404 on the public CRM edge.

The backend still validates exact HTTPS Origin, key, IP, input and current
recipient authority. It is not an Auth bypass for staff pages. Website access
logging is not enabled; existing CRM logs redact the two new private headers.
No customer values, keys or adapted production config are to be printed.

## Private key without recreating Caddy

The shared edge must not be stopped or recreated. Its existing named volume
`evo-edge_evo_edge_caddy_data` is already mounted at `/data`. The operator
provisions **one required private file**:

`/data/evo-website/intake-header.caddy`

It contains one `header_up X-EVO-Website-Key` directive with exactly the same
43–128-character base64url key as the CRM runtime's
`EVO_WEBSITE_INTAKE_EDGE_KEY`. Derive it only from the private configuration;
validate the alphabet/length before serialization, write via a private stream,
and set directory0700/file0600. Never include a real value in a shell argument,
Git, tool output or CI log. The committed `.example` has `NOT_CONFIGURED`, which
is only parser input for isolated verification and is not a usable credential.

This required Caddy import persists across reloads **and cold starts** without
new Docker environment variables or mounts. A missing/malformed import prevents
validation/reload; the previous live config keeps serving. A later cold start
also requires this persisted file: do not remove the volume/file, change its
path, or rotate only one side. An `env_file` change would require container
recreation and is deliberately not used. A process-only environment during
reload would not satisfy cold restart and is not the deployment procedure.

## Release-owner procedure (not executed by this code slice)

1. Confirm the merged exact CRM receiver SHA, migration170, real eligible owner,
   matching private key and independently accepted website image. Preserve the
   real inquiry requirement; do not use invented customer data as acceptance.
2. Read the current loaded hostnames, mounted source checksum and edge identity.
   The read-only2026-09-16 baseline source is
   `/opt/evo-releases/ee8a825ebc72f84449636e3feaefab7a330913d4/repo/agent-lead2-inbox/deploy/Caddyfile.evo-edge`;
   baseline SHA256 is `cccd9dcffde5d515625c3b9158527ffd3672cd8504af7f7a2348a7a8b4b58b92`.
   Five live routes are CRM, invite-bishkek, inbox, codex and OlympiadAI sslip
   hosts. Reconcile any later edits; do not overwrite a changed baseline.
3. Provision the private import first through the existing mounted volume.
   Stage the reviewed Caddy source beside the existing bound file. Validate it
   with the actual running Caddy binary and private import, without dumping
   adapted JSON or secret values. Compare its SHA256 to the reviewed commit.
4. Preserve the bind mount's original file/inode when writing the accepted
   source; replacing the host inode with a rename can leave Docker on the old
   file. Keep the previous non-secret config bytes for rollback. Use
   `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, then
   `caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` inside the
   existing container. Do not run Compose up/down or Docker restart.
5. Confirm unchanged container ID/restarts, the same five old sites plus
   apex/www in loaded config, source checksum, expected upstreams and private
   header presence/equality using Boolean-only readback. Bind the receipt to
   reviewed source SHA plus config hash; retain the private snippet hash only
   in private operator records, never its contents or key. Do not dump the
   Caddy admin API/autosave JSON: it contains the adapted header credential.
6. Root coordinates authoritative DNS and Caddy automatic HTTPS. Verify apex
   and www HTTPS/TLS, real website asset hashes and all existing routes. Submit
   the owner-approved real inquiry, see its preserved fields in Platform and
   retry its same UUID without another lead. Keep this separate from syntax/
   routing validation. If a change fails, restore the prior non-secret config
   into the same inode, validate and reload; leave other services running.
7. Only after those checks may the owner proceed with Web-X retirement. Mail,
   MX and authoritative nameservers can still depend on Web-X; website success
   alone does not authorize removing those services or their data.

## Verification scope and primary sources

Run `bash scripts/test-p7b-caddy-runtime.sh` under the supported local container
runtime. It exercises the real source on pinned Caddy2.11.3, with a deliberately
non-secret import for parsing; it does not emulate or accept a successful lead.
Separately validate the full config with real Caddy and compare adapted route/
header/body contracts without a customer input. No production changes are made.

- [Import: required file and parsing](https://caddyserver.com/docs/caddyfile/directives/import)
- [Graceful reload and validation](https://caddyserver.com/docs/command-line#caddy-reload)
- [Proxy rewrite and header overwrite/removal](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Body limits](https://caddyserver.com/docs/caddyfile/directives/request_body)
- [Placeholders](https://caddyserver.com/docs/caddyfile/concepts#placeholders)

## Actual local evidence (2026-09-16)

- Node22 `npm ci --ignore-scripts`: passed, audit0. No application dependency
  changed. Shell syntax and `git diff --check` passed.
- Full source `caddy validate` on the production-pinned2.11.3 digest, network
  disabled, example import mounted read-only: `Valid configuration`.
- The same real validator without the private import returned exit1 / file
  missing as expected. No default key or alternate route was substituted.
- `bash scripts/test-p7b-caddy-runtime.sh`: passed actual local HTTP guards on
  both apex/www for GET/PUT/OPTIONS→405 and other/malformed API paths→404,
  the direct CRM receiver→404, existing private/path guards and credential-log
  redaction. Its uniquely owned container was removed. No upstream or successful
  lead response was invented; the CRM/static upstreams were absent locally.
- Real `caddy adapt` assertions passed: all7 hosts, exact POST matcher, private
  CRM rewrite, header overwrite/removal, socket IP,8000-byte edge body cap and
  website upstream. The non-secret example was used, not a production key.
- Read-only comparison against the mounted VPS source confirmed all5 existing
  site blocks byte-identical. The only existing shared-snippet changes are the
  intentional CRM receiver denial and new header redaction. Caddy's formatting
  warning points at the unchanged space-indented OlympiadAI block; preserving
  those live bytes was intentional, and validation succeeded.
- Actual Compose config validation passed; its change is comments only.
  Existing changed-path classifier tests passed15/15; gates were not weakened.

Candidate Caddyfile SHA256:
`9a49f6a38a4dabe2896ca6a85bf94f93d30d6c9c9fbda9fe7205bacc836d9e4d`.
Context7 and primary Caddy documentation were checked2026-09-16. No server
mutation, real key provisioning, reload, DNS change, inquiry or retirement was
performed by this implementation agent. Root must record those separately.
