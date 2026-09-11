# Accepted portal retirement — real verification record

Date: 2026-09-11. Times are UTC.
Contract: [retirement and real acceptance](../portal-retirement-real-acceptance-plan.md).
Status: reviewed removal merged, managed migration applied and guarded app
release accepted. Real Student/customer/multi-employee journeys remain partial.

## Reviewed revision and schema proof

- [PR #735](https://github.com/izzhackt/evo_AI_CRM/pull/735) merged at 09:37:46
  as `268bbdbca7aeb2cc2ba0acaece0a3838e98a6f51`. Its tree equals independently
  approved head `cba37b0ad6e912955963f0dd791a2252b2e6c3b2`.
- [Fast checks 34584478693](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34584478693)
  passed, including the actual migration boundary and release contracts.
  App build/lint were correctly not selected for SQL/docs; full local ESLint
  and shell syntax/diff checks additionally passed on Node 22.23.1.
- The owned temporary database `evo_portal_retirement_schema_20260911` used
  schema-only definitions from the actual local Supabase foundation 001–125
  and actual forward migrations 126–151. The new test was RED before 152 and
  GREEN after applying the actual migration 152. No mock bootstrap or Auth,
  membership, lead or case rows were copied/created. Five retained function
  definitions, owners, grants and settings matched before/after, including
  portal v2 and the task authority path. The exact owned temporary database was
  dropped; readback found none. Source local ledger 125 remained unchanged.
- [Independent review](https://github.com/izzhackt/evo_AI_CRM/pull/735#issuecomment-5632450855)
  approved the exact head and inspected the actual RED/GREEN and equality proof.
- [Exact-main full CI 34585205187](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34585205187)
  passed all five jobs on its only attempt against frozen `268bbdbc`, with
  release arm=false. Database/browser proof took 8m8s; Node/static took 2m17s.
  Production acceptance is not inferred from these isolated checks.

## Managed migration readback

[Schema ledger run 34585949969](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34585949969)
passed against the same frozen `268bbdbc`. The official linked dry-run selected
only `152_platform_retire_student_portal_v1.sql`; application finished at
09:48:04 and returned the exact ledger 001–152. No earlier migration was replayed.

Independent managed read-only SQL afterward confirmed:

- Ledger count 152, latest version 152; no v1 overload remains and v2 exists.
- No other stored routine source references the retired v1 name.
- Portal v2 definition MD5 stays `0bfe55ff50e206422e198ba17d1a8122`, with
  `{postgres=X/postgres,authenticated=X/postgres}` grants.
- Public 11-argument task wrapper MD5 stays `c04be49719e68cd92ecf8f789e6e1c50`
  with the same authenticated/postgres grants; private canonical coverage body
  stays `3ee8944a687a499dfa621dfacefbdfe4`, granted only to postgres.
- Actual `authenticated` role without a user session receives zero v2 rows.
  No JWT or Student identity was fabricated.
- The same one active Admin, zero leads and zero student cases remain.

These are real managed schema/authority checks, not private Student workflow
acceptance. Restoring an application image does not restore v1; the immediate
previous accepted `6ac8007f` already uses v2 and remains compatible with 152.

## Guarded application release

[Release 34585916884](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34585916884)
attempt 1 was intentionally skipped while arm=false. After full CI and managed
152 passed, current main and actor were checked again, arm=true was read back,
and the entire downstream release was rerun (attempt 2). The upstream CI was
not repeated. Both build and deploy/accept jobs passed, including the real
authenticated read-only browser smoke and exact-candidate acceptance steps.

Independent server readback:

- Revision: `268bbdbca7aeb2cc2ba0acaece0a3838e98a6f51`.
- Accepted pointer: `v3-r34585916884-a2-268bbdbc`.
- Container image: `sha256:cdf72b4331043e61218352f00bcdfdcfc7508a9571c89507dd3f34ea75b9c9d6`;
  image revision matches the accepted pointer. Container healthy, zero restarts.
- Acceptance-record SHA256:
  `84f3f58fa187aa1603252c61f90bd6c05fdb6f546713a8b288ea933d3d38c270`;
  independent server `sha256sum` matches the pointer.
- No `pending-current.json`. The new release-owned `rollback-command.sh`
  exists; do not substitute a previous release wrapper.
- Release arm reset to false; fresh GitHub API readbacks confirmed false after
  its update at 09:53:40. An immediate read after the update briefly returned
  the previous true value; the later readbacks, not that transient response,
  establish the final state.
- Public HTTPS health from VPS returns 200/live with normal TLS validation.
  The Mac's public-HTTPS trust problem is separately diagnosed below.
- Existing localhost:3000 tunnel still targets the same app IP and returns
  200/live. Post-release real Chrome opens the new portal overview; the real
  verification task retains its result and selected `done` / «выполнена» status.
  A native screenshot confirms the published portal. Anonymous portal and
  Admin-preview requests still redirect to login. No tunnel reset was needed.

### Mac public-HTTPS trust finding

At approximately 09:52, normal system `/usr/bin/curl` on the Mac failed with
code 60 (unable to get local issuer certificate). Independent read-only TLS
checks from Mac and VPS used the same IP 72.62.119.112 and hostname/SNI:

| Evidence | Mac path | VPS path |
| --- | --- | --- |
| Certificate issuer | Fortinet CA | Let's Encrypt YE2 |
| Leaf SHA256 prefix/suffix | `D28208D8…A283D2AD` | `D4EC57E0…8206715C` |
| Certificate/hostname validation | verify 20; curl 60 | verify 0; hostname matches |
| HTTPS login | TLS rejected | HTTP 200 |

The genuine server certificate is valid September 5–December 4, 2026 and includes
the exact hostname. Its chain validated to the trusted ISRG root. This evidence
shows certificate interception on the local network path, not a detected
server-chain, expiry or hostname error. The specific Wi-Fi appliance, VPN or
local agent responsible has not been identified. Fortinet documents this
[SSL inspection mechanism](https://docs.fortinet.com/document/fortigate/8.0.0/administration-guide/122078).
Do not change Caddy, disable certificate checks or install an unverified CA to
make the check pass. No such changes were made. The authorized SSH tunnel works.

## Native working checks before retirement

These browser checks used accepted production app `6ac8007f` through its
existing SSH tunnel, a normal real Admin login and the same managed database.
There was one active Admin membership, no Student membership, no leads and no
student cases. Historical imported sales are a separate existing register.

- General chat: a truthful operational message appeared in a second already
  open tab without reload, then survived sender reload. A real verification
  task was created from the message, assigned to the current Admin, completed
  with the observed result and reopened after reload with that result intact.
  Source-message/task cross-links, a thread reply and searching for the parent
  message worked. These are genuine work records retained as evidence, not
  fictional clients. One Admin/two tabs does not prove two-employee delivery,
  unread counts, revoked access or offline reconnection.
- The actual Admin lead form opens with Admin selected as responsible. No lead
  was submitted. Staff settings show one active Admin and no invitations sent.
- Sales report opens its existing imported data. Switching September 2026 to
  the full year changes the URL and displayed rows. No repeat import, new
  payment, contract confirmation or reporting target edit was performed.
- Main, Inbox, tasks, calendar, knowledge, universities, Admissions and its
  manager summary load meaningful content or honest empty states. Admissions
  has China/Malaysia/Europe/UAE/Turkey selectors; the CN/MY case route cannot be
  exercised without a real case. Empty Inbox is not WhatsApp delivery proof.
- All seven Admin-preview sections load: overview, documents, applications,
  universities, payments, notifications and tests. The catalogue is real;
  photos in the viewed portion rendered. This is not a repeat of the prior
  whole 143-photo acceptance. Offscreen lazy images were not counted as failures.
- English preview displays its 36 original questions and supports navigation;
  career preview displays 92 questions with Russian instructions. No answers,
  Student attempts or scores were created. Private sections remain empty in
  Admin preview by design; a normal Admin opening `/portal` returns to staff
  `/v3/main`, retaining the staff session.
- Anonymous `/portal`, `/portal/tests`, `/preview/student` and `/v3/profile`
  redirect to login; health returns 200/live. Auth was not bypassed.
- Observed console errors in the chat flow originated in a Chrome extension
  toolbar, not EVO scripts. Do not describe the console as completely empty.

## Observed issues, not silently changed

1. Task `open` and `in_progress` both display «в работе». The shared labels and
   actual dropdown confirm the ambiguity. Follow-up should change wording,
   not stored task semantics or the unrelated Admin reason policy.
2. Disabled operational observability is rendered as Supabase unavailable,
   although actual Auth/chat/task/database operations work. A later narrow UI
   correction should distinguish unconfigured diagnostics from an outage;
   do not report providers healthy without actual proof.
3. Historical sales manager labels have punctuation variants in their filter.
   Exact-label import aggregation explains separate options, not duplicate
   employee accounts. Confirm any alias mapping before consolidating history.

## Integrations and remaining real inputs

Read-only VPS/private-service checks found app and ClamAV healthy, with zero
restarts at that snapshot. The existing CRM WAHA session `crm_primary` reported
`SCAN_QR_CODE`; no QR was retrieved, session restarted/paired or message sent.
Current app amoCRM commands are disabled and lack a configured origin/token
path. That does not establish whether historical credentials exist elsewhere.
Protected readiness is disabled. No provider was enabled or reconfigured.

To continue without repeating completed work:

- One approved genuine client with name, reachable email and direction, and
  actual contract/first-payment grounds (or separately authorized exceptional
  handoff). Existing Admin can own both Sales and Admissions for this journey.
- The student receives the actual invitation, chooses their own password and
  uses their own normal session to answer the tests and check save/resume/result.
  No password or private answers are needed in chat.
- One actual required document uploaded privately to its real case slot. Then
  exercise ingress scan, stored-byte rescan, finalization, curator review and
  private download. Scanner health alone does not establish this sequence.
- A real case per country and genuine partner/submission/decision/visa/arrival
  evidence are needed for full CN/MY route acceptance. Begin with one country
  if appropriate; never advance events that have not happened.
- A second approved real employee is needed for different-user chat/unread/
  access checks. It is not required merely to prove Admin can do both roles.
- When the owner is ready, explicitly authorize the WhatsApp phone connection
  and amoCRM activation/revalidation using the intended existing account.
  Do not assume new credentials must be issued or overwrite existing ones.

Issues #693 and #708 remain open for real acceptance; #687 retains its separate
Admin task-reason decision. No new permanent database/account, reset/reseed,
backup, catalogue republication or historical-sale reimport was performed.
