# Admin / chat / universities: execution evidence, 10 September 2026

## Reviewed implementation

- Issue [716](https://github.com/izzhackt/evo_AI_CRM/issues/716),
  PR [717](https://github.com/izzhackt/evo_AI_CRM/pull/717).
- Independent review approved exact head
  `308d46356491d83ebac993f515487deb2e23dc96` against `cde07abc`; no actionable
  findings. All 21 files and seven documents covered; recorded in the PR comment.
- PR run [34461379597](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34461379597):
  all six checks passed. Local TypeScript, full ESLint and production build passed;
  seven changed Markdown documents / 46 local links resolved.
- Merged 09:45:06 UTC as **`89302b7b09720e1bcc282a44bac64deac53b86f4`**.
  Its tree equals the reviewed head. Do not reapply the source PR.

- Follow-up [PR718](https://github.com/izzhackt/evo_AI_CRM/pull/718) corrects only
  handoff proof identity and records the decision. Independent review approved
  exact `d2dea0ea76d2de5b638cc90062f1035ab60d394f`; no findings. TypeScript,
  scoped ESLint and diff-check passed. Fast run34463887898 passed selected
  lint/release-contract/change/gate checks; build/migration jobs were legitimately
  unselected for this test/docs-only diff. Merged10:04:40 UTC as
  `894801eb86ec4310c366242418c50dce7d0cb6a0`, with tree equality verified.

## Genuine schema execution, not business acceptance

The owned ephemeral database `evo_admin_schema_compile_20260910` used a schema-only
copy of the existing real local Supabase125 definitions, then actual repo
migrations126–150. No mock bootstrap or copied Auth/customer rows. Auth users,
memberships, leads and student cases remained zero. `plpgsql_check` reported zero
errors across 13 changed PL/pgSQL functions. The nine-argument137 API remained.
Actual institution JSON passed the actual SQL validator16/16. Migration150 kept
its validator owner/ACL, changing only the ten new photo keys.

The owned ephemeral database was dropped after verification using its actual
`supabase_admin` owner; readback count is zero. The initial drop as `postgres`
failed without changing anything. Existing databases and real rows were untouched.

The first compilation failed closed on the long-removed `sales_handoff_summaries`
API (dropped078); two stale patch targets were removed before review/merge. That
API was not recreated. Final migration149 SHA256:
`1d759992662dba5dcbe5b09d49412c711bcade5e2bfc5d496284c0cf877670e8`;
150: `aea6668e96c36389b9f9161f27c5b86141c00e2dc5376e3374862c4652a17d5c`.

Managed [schema run34462429988](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34462429988)
passed on exact main89302b7b. Read-only inventory found001–148; dry-run listed only
149/150. They applied at09:46:37/09:46:41 UTC; final ledger001–150. No old migration
or sales import was repeated, and no new backup was started.

## Release and browser checkpoint

- Exact-main full CI [34462582012](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34462582012)
  failed: `supabase-staff-auth.spec.ts:1465` expected an Admissions-token handoff
  context request to be denied, but received200. Source tracing established that
  the proof selected the first enabled owner, now alphabetically `Local Admin`
  before `Local Admissions Manager`; the existing handoff invalidates only the
  selected owner's access version. The unrelated Admissions token correctly
  remains fresh. CI retained no artifact with the selected UUID or response body;
  the cause is a deterministic source trace, not a recovered request payload.
  The correction selects the actual authenticated Admissions membership explicitly,
  preserving all denial expectations and normal RPC behavior.
  The later D2 receipt-file absence is downstream of the interrupted first test.
  Other admission, Node/static and dependency checks passed.
- Release [34463081296](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34463081296)
  was skipped by the guard. Root set `EVO_PRODUCTION_RELEASE_ARMED=false` and
  verified readback. No application rollout occurred. Any corrective revision
  needs fresh exact-head review and successful full CI before a guarded release.
  Do not merge final closeout while a future release is armed/current-main-bound.
- Correction full CI [34464151281](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34464151281)
  passed all five jobs against exact main894801eb, including actual database/browser
  proof7m54s. Operator ID was matched to the configured
  release actor before arming; arm=true was read back. Disarm after success/failure.
- Guarded release [34464897482](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34464897482)
  passed and accepted exact894801eb. Arm=false was read back after completion.
  Server pointer `v3-r34464897482-a1-894801eb`, acceptance SHA256
  `f20e537d9485dba23e27c22d047b24d211b807c65c3b1f1aa869aba9aa4ca7cf`;
  image `sha256:b5372802356a3728f885ad04b865bb009ce7a6d5c383924481e9f89ed06713bb`.
  App healthy/restarts0, pending absent, IPs172.16.8.4/172.16.1.4 unchanged.
  Localhost reload exposes all16 reviewed templates and the initial zero drafts.
- Old SSH process93942 ended. Restored only the requested localhost forwarding:
  process65062, `127.0.0.1:3000` → `hermes-vps:172.16.8.4:3000`; localhost login200.
  Recheck container IP after rollout. No local product app/database was launched.
- Public HTTPS health was200 from the VPS. This Mac curl reports inability to
  verify the local issuer; certificate validation was not disabled or bypassed.
- In the genuine existing Admin browser, the original empty-owner failure was
  reproduced before149. After149 the normal pipeline page lists Admin; opening
  «Добавить лида» shows editable fields and **EVO Admissions Admin** selected as
  responsible. No real or fictional lead was created.
- Historical pre-894801eb checkpoint: the catalogue contained five published
  institutions and zero pending drafts. The11 new templates then awaited rollout
  and ordinary Admin publication; that work is completed in the section below.
  Do not duplicate any of the now16 published institutions.

## Ordinary Admin publications on accepted894801eb

Each entry below was staged once, its real preview reviewed (public fields,
source/caveats and image), then approved through the normal Admin checkbox/button.
The action itself redirected to its canonical URL; no manual navigation supplied
the success destination. Canonical readback confirmed published version1.

| Template | Canonical institution UUID | Photo readback |
| --- | --- | --- |
| taylors | b6214cbe-6d08-4a33-86b4-cdf5cc6ca5e2 | loaded960px |
| inti | 14422182-fc89-4680-9922-932b5f7ce98c | loaded |
| ucsi | 8f8c1b0f-f4e3-48ca-8058-bf5280685968 | loaded |
| city-malaysia | bfdcf2e9-1f52-4af0-a1ae-9ed6f6a2d94b | no verified photo, explicit placeholder |
| xiamen-malaysia | 2ae13bec-8906-4be1-a0d2-48dbffb0d36a | loaded |
| monash-malaysia | d122eb03-ce83-46ee-b656-5fe33816c2d5 | loaded |
| scut | d086e0df-d434-4bfc-97ab-b2335df90d07 | loaded |
| zjut | c51ff26d-a4ed-4099-9295-4666a4965777 | loaded |
| gdut | 35597246-430f-4385-90cf-5f3c77af93fb | loaded |
| upc-east-china | 36864f43-3c9b-4964-a266-3755d4571f77 | loaded |
| ecust | fd296b6a-28d6-45ea-8db8-7397d01c9eaa | loaded |

UCSI stage response exceeded one browser selector deadline; inspection found the
already-saved draft and continued it. No second draft or repeated save was made.

Final catalogue DOM contained16 distinct canonical institution UUIDs (each appears
as both a title link and a details link). Management readback: `На проверке (0)`.
Actual GET filter forms returned7 China institutions and9 Malaysia institutions;
the full unfiltered catalogue was restored afterwards.
All10 new non-null images loaded in both preview/canonical views; the four prior
photo records were unchanged, yielding14 photo-backed cards and two explicit
no-photo cards. Desktop three-column layout and narrow single-column/filter stack
were visually inspected. Browser zoom/scrollbar affects emulated dimensions:
at content width393, scrollWidth393 (innerWidth403); at clientWidth319,
scrollWidth320 (innerWidth329), the existing320px minimum. Do not claim an exact
320px zero-overflow measurement. Viewport was reset after inspection.

Genuine Admin `/v3/team-chat` reached `Сообщения появляются автоматически` with
three channels and no ordinary `Обновить историю` button. History remains empty;
no chat message was sent. The sampled console errors originate in a Chrome
extension toolbar, not EVO code; no extension setting was changed.
The post-release pipeline form also opens with `EVO Admissions Admin` selected
in `owner_id`; the original no-Sales blocker is absent. Fields remain empty and
no lead was submitted.

## Admin self-handoff session follow-up

Source tracing found that new Admin-to-self handoff makes that same actor's token
stale via the existing access-version bump. It commits successfully but can then
redirect the page to login. [PR719](https://github.com/izzhackt/evo_AI_CRM/pull/719)
refreshes only after its validated self-handoff receipt and verifies signed claims
plus the exact same live Auth/profile/member/org/Admin authority. Failed recovery
redirects outside the mutation catch; it cannot create a false unsaved/retry state.
No generic stale-token relaxation, migration or new business records.

Independent review approved exactc820c0a7 against894801eb with no findings. Focused
static regression RED→GREEN, two selected contracts, TypeScript, scoped ESLint and
diff-check passed. Fast PR run34465820719 passed all selected checks including build;
migration boundary was unselected because no SQL changed. Merged10:25:51 UTC as
`a52cca376ff05db8dcc220d4b043720fe98a6f6c`; tree equality verified. Exact-main full CI
34466066204 passed all five jobs, including database/browser7m51s. Guarded release
34466804312 succeeded and accepted that exact revision. No real self-handoff or
browser cookie propagation is claimed as business acceptance.

## Final accepted runtime and handover

At10:40 UTC root read back the following, independently of the CI result:

- `EVO_PRODUCTION_RELEASE_ARMED=false`, set after release completion and verified.
- Accepted revision **`a52cca376ff05db8dcc220d4b043720fe98a6f6c`**;
  pointer `v3-r34466804312-a1-a52cca37`.
- Acceptance record SHA256
  `368c789a6103ced3116ff444db9e9419644147e0850eaefee255973be5f15b3a`, independently
  matched with `sha256sum` on the actual server file at10:40:18 UTC.
- Actual app image
  `sha256:b1afa1fe483e116e18d56981446bf55c89d39422c77d67dd7eb6de432b329b05`;
  healthy, zero restarts, IPs172.16.8.4/172.16.1.4 unchanged, pending pointer absent.
- Public HTTPS `/api/health`200 from the VPS and localhost `/api/health`200.
  Production: <https://evo-crm.72.62.119.112.sslip.io>.
  Same-server preview: <http://localhost:3000/v3/universities>.
- Genuine Admin browser reload after final rollout retained16 distinct published
  institution UUIDs and the `Университеты` heading. The catalogue remains open.

No migration, publication, sales import, local product database or backup was
repeated for the session fix. This final handover is documentation-only and does
not require another application release. Recheck live pointers before future
changes; do not use the older VPS Git checkout as the deployed application SHA.

## Explicit remaining limits

No authorized work message has been sent: the one request for permission remains
unanswered. The existing private connection is verified, not actual delivery,
reconnect or two-employee unread/revocation. No repeated question is necessary.
Real lead→handoff→case acknowledgement/coverage/finance/provisioning journeys and
Student-owner live access require genuine inputs; code/schema checks do not claim
these outcomes. Student-private assessment restrictions remain unchanged.

The first expansion is11 institutions/10 new photos, not all98 discovered notes.
City and existing APU have no verified photo; OUC remains unpublished pending a
readable official guide. Further programmes, costs and future deadlines need
their own verified sources; no historical date was rolled forward.
