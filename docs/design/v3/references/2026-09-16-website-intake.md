# Website intake into EVO Platform

Status: implementation candidate, not production delivery evidence.

## Boundary

`https://evoadmissions.com/api/website-leads` is a same-origin POST proxied by
the website's trusted Caddy edge to the private Platform app at
`/api/public/website-leads`. The edge **overwrites** `X-EVO-Website-Key` and
`X-EVO-Website-IP` using its runtime secret and the real socket client address.
Never forward caller-supplied values or arbitrary `X-Forwarded-For`; deployments
behind another proxy need an explicitly reviewed trusted-proxy configuration.
Keep the app/container private. CRM public host need not expose this route.

The handler requires both the private edge key and an exact Origin of
`https://evoadmissions.com` or `https://www.evoadmissions.com`. No CORS grants,
browser secret, session impersonation, direct amoCRM call or secondary database.
The browser sends `credentials: "omit"`. Caddy must not forward browser Cookie
or Authorization to this route. Enforce `request_body { max_size 8KB }` at the
edge before proxying (the shared app permits larger bodies for documents).
Requests are also bounded to 8 KiB in the handler and a 5-second
body-read deadline; the database call has a 10-second transport deadline.

## Configuration

Reuse `NEXT_PUBLIC_SUPABASE_URL`, `EVO_PLATFORM_SUPABASE_SECRET_KEY` and
`EVO_PLATFORM_ORGANIZATION_ID` from the existing neutral backend runtime.
Add only `EVO_WEBSITE_INTAKE_OWNER_MEMBERSHIP_ID` (the explicitly selected real
recipient) and `EVO_WEBSITE_INTAKE_EDGE_KEY` (43–128 base64url characters, generated
and stored through the private runtime secret workflow). The owner must remain
eligible for `lead.read` and `lead.sales.workflow.manage` scoped assignments.
No default employee, UUID, password or key is embedded. Missing/invalid setup
returns503, not pretend success. Compose already consumes the private app env
file; do not expose these variables as public/build arguments.

## Public contract

POST JSON fields, all keys present: `requestId` UUIDv4, `name` (1–300 chars),
`phone` (7–15 normalized digits, optional leading +; spaces/parentheses/dot/hyphen
accepted before normalization), `age` (integer10–100 or null), `city` (1–150 chars
or null), `country` (exact approved label), `consent:true`, `website:""` honeypot.
Countries: China, Malaysia, Europe, Germany, United Kingdom, Italy, Netherlands,
France, Poland, United Arab Emirates, Turkey. Preserve the exact label in the
receipt; derive canonical direction only for a newly created lead.

- 200 `{status:"accepted",requestId}`: committed new, repeated or duplicate-contact
  submission. This intentionally reveals neither contact existence nor lead ID.
- 400 `{error:"invalid_request"}`; 403 `forbidden`; 409 `request_conflict`;
  413 `request_too_large`; 415 `unsupported_media_type`; 429 `rate_limited`
  with `Retry-After:600`; 503 `unavailable`.

Freeze payload and UUID during submission/uncertain retry. Success requires both
HTTP200 and the matching receipt. A changed payload needs a new UUID; never
silently generate a new UUID after a timeout. Responses use `Cache-Control:no-store`.
No submitted values, raw IPs, private headers or secret hashes belong in logs.

## Database and UI

Migration170 adds service-only `platform.receive_website_lead`, private immutable
receipts and durable rate buckets (5 new requests per IP/10min,100 per org/hour).
Exact replay is idempotent. IP is HMAC-pseudonymized before the RPC; old IP buckets
are deleted after24h during accepted-rate activity. These are an initial bounded
abuse control, not a claim of bot-proof protection.

Creation reuses canonical client/lead helpers and the existing manual-intake
phone lock. An existing active client is not renamed; its newest open lead is
reused without changing ownership or stage. Multiple client matches fail closed.
An existing client without an open lead receives a new website lead. Each receipt
preserves submitted name/phone/age/city/country/consent. Audit actor is service.
Staff may read the latest10 inquiries only with live canonical lead authority;
Student and unauthorized staff cannot read the private receipt table.

The lead profile shows a compact expandable “Заявки с сайта” section. Failed
reads are visibly unavailable; an empty authorized result means no section.

## Verification and deployment

Apply the actual001–170 schema chain in an owned, network-isolated PostgreSQL
container with `bash scripts/check-website-intake-schema.sh`. This checks schema
and grants without creating customers and removes only its own container.
It is **not** a test of successful intake or a substitute for real acceptance.
Run focused lint/generated Next types/typecheck and independent review. Use
the managed release workflow; never edit applied migrations or production code
directly. Configure and verify the edge without printing its key.

Required real acceptance: owner supplies one actual intended inquiry, submit
through the website, observe it in Platform Sales, verify preserved fields and
same-request retry with no extra lead. No real input has been supplied in this
implementation slice, so that acceptance remains explicitly unperformed.

Sources: [Supabase functions](https://supabase.com/docs/guides/database/functions),
[backend API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Next route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route).

## Candidate validation receipt (2026-09-16)

- Node22 `npm ci --ignore-scripts`: passed, dependency audit reported0 vulnerabilities.
- Focused ESLint on the handler/source/profile/route files: passed.
- `next typegen` then `tsc --noEmit`: passed. Raw typecheck before Next generated
  its image declarations reported the pre-existing logo import; normal Next type
  generation resolved it without modifying the logo or adding a declaration shim.
- `bash scripts/check-website-intake-schema.sh`: passed actual contiguous001–170
  migrations and RPC privilege assertions on pinned Supabase PostgreSQL17.6.1.143
  under OrbStack, network disabled. Zero client/lead rows. Owned container
  `evo-website-schema-27706-41471` was removed by the script.
- Actual Next development server on loopback3221: POST without runtime setup
  returned503 `unavailable`; GET returned405. No user/customer payload, provider
  request, alternate credentials or fake response. Server stopped afterward.
- `git diff --check` and shell syntax check passed.

These checks prove schema compilation/grants, TypeScript and the unconfigured
HTTP boundary, **not successful inquiry delivery, RLS business acceptance,
customer-visible UI rendering or production readiness**. The candidate is to
remain a draft PR until the release owner resolves configuration, real acceptance
input and deployment prerequisites. No production migration/configuration was
performed by this slice.
