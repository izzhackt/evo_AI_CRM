# P8U single-UI private preparation

Issue: #276

## Outcome

Prepare the existing root EVO CRM as the only Platform UI while production
Supabase Auth activation is deferred. This block does not publish an
unauthenticated application. It produces reviewed repository code and a private
candidate only.

The accepted root `/whatsapp` workspace remains the product surface. The EVO
Inbox companion is a temporary donor and rollback boundary, not a second UI to
embed through an iframe, proxy zone or public navigation. Next.js multi-zones
remain inappropriate for the tightly coupled operator workflow because routes
frequently used together would cross applications and perform hard navigation:
https://nextjs.org/docs/app/guides/multi-zones.

## Observed stop

The reviewed P8D4T preflight completed without production effects and wrote the
local mode-`0600` result with SHA-256
`d9073cab6e768411aff6a9c449789a935ee7c30a8ee103496facae753dc5f165`.
Immediately before mutation, a read-only runtime check found that the frozen
CRM candidate and `/opt/evo-crm/.env.production` contain neither
`NEXT_PUBLIC_SUPABASE_URL` nor
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The current root client requires both.
Supabase documents both as required SSR client configuration, and Next.js
documents that `NEXT_PUBLIC_*` values used by client code are inlined at build
time:

- https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&package-manager=npm&queryGroups=framework&queryGroups=package-manager
- https://nextjs.org/docs/app/guides/self-hosting#environment-variables

P8D4T therefore stopped before staging, configuration, import, deployment,
restart or provider calls. Its action-time token is retired and cannot
authorize this changed candidate.

## Scope

### P8U1 — root-owned staff knowledge seam

- Inventory the two reviewed staff-only knowledge flows currently exposed by
  the companion (`client` playground and `internal` assistant), their importer
  and body-free audit contract.
- Implement the smallest root-owned server/repository seam needed by the
  accepted root Platform UI. Reuse the canonical managed Supabase schema and
  frozen knowledge bundle contract; do not copy the companion dashboard,
  pipeline, broadcast, flow, campaign or general settings UI.
- Keep Gemini calls draft-only and staff-triggered. No autonomous reply,
  outbound send, WAHA mutation or amoCRM access is added.
- Keep every route protected by the existing Platform actor/authority seam.
  Auth may be unconfigured during preparation, in which case the route must
  fail closed. There is no `AUTH_DISABLED`, demo-user or anonymous-staff mode.

### P8U2 — private candidate

- Build one new root CRM candidate on OrbStack for `linux/amd64` from the
  reviewed merged source.
- Run the real dependency-free health/readiness checks and the existing
  repository tests. Provider and customer-content calls remain prohibited.
- Retain closed build/image evidence locally. The candidate is not routed by
  Caddy, installed over a live container or exposed through a public no-auth
  endpoint.
- The current production CRM, companion Inbox, Lead Agent and both WAHA
  containers remain unchanged.

### Later Auth activation and release

A separate reviewed block must provision the exact production Supabase URL,
publishable key and Platform admin authority, then rebuild if client-bundled
configuration changes. It must prove real sign-in, RLS/object scope, session
refresh and logout before public cutover. Only then may a new release contract,
fresh preflight and new action-time token authorize production mutation.

## Stop conditions

Stop without substitute behavior on any of the following:

- an implementation requires bypassing Platform auth/RLS or exposing real data
  anonymously;
- a proposed route revives the companion as a second public product UI;
- provider, knowledge-import, WAHA, amoCRM, send, DNS/Caddy, restart or billed
  resource authority would be required;
- current production, candidate, migration or knowledge identity drifts;
- real tests require mock/demo/customer data or an unreviewed credential;
- independent exact-head review or CI is not green.

## Completion evidence

- P8U1 and P8U2 each use their own issue/PR and independent exact-head review.
- Exact-head CI and post-merge exact-main CI are green.
- Root tests prove protected failure when Auth is absent and no public bypass
  exists.
- Private candidate evidence records the exact source/tree/image/platform and
  provider-disabled state without secrets, UUIDs or customer content.
- Production container identities and restart counts remain unchanged.
