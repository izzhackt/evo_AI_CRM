# Student/Admissions production acceptance — 9 September 2026

This is a bounded technical release record, not owner business acceptance or a
claim that a real production Student completed an assessment. All times are UTC.
No credentials, customer rows or screenshots of customer data belong in this note.

## Exact release

- Candidate: `76c62b902d9a2e094be8fcd65259a4962ad597b1`, exact current main when
  admitted and accepted. Reviewed browser-expectation repair [#705](https://github.com/izzhackt/evo_AI_CRM/pull/705)
  had head `f48927b24246e07f64b289ae9ae805836773c8e4`; its tree matched the merge.
- Full [CI34391182045](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34391182045):
  all five jobs passed, including the real database/browser proof. No scenario
  skip or synthetic receipt was added to repair the preceding failed CI.
- Automatic [release34391907814](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34391907814):
  completed successfully. `Authenticated read-only V3 browser smoke`, both final
  acceptance guards and `Accept exact V3 candidate` passed. Failure-only rollback
  steps were intentionally skipped because acceptance succeeded.
- Release ID: `v3-r34391907814-a1-76c62b90`; version `r29.1-76c62b90`.
- Running app image:
  `sha256:6a4e8ba023496e1eb5d35e3a3892ff5e28500d21a7d1e7833c37ad7ac36263b1`.
- Canonical source remains Supabase `iosckaqtovbbnssqcpde`. Schema check
  [34389381978](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34389381978)
  and apply [34389465309](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34389465309)
  applied only reviewed migrations 135–138. The later release read the exact same
  001–138 ledger before mutation and acceptance; do not reapply the migrations.

## Server readback and disarm

On `hermes-vps`, `/opt/evo-crm`, Compose project `evo-crm`:

- `/opt/evo-crm/release-evidence/current-v3-accepted.json` names this revision and
  `v3-r34391907814-a1-76c62b90/v3-acceptance-record.json`. Pointer modification
  time is `2026-09-09 18:59:42.798256088 +0000`.
- The acceptance file's actual SHA-256 matches the pointer:
  `4c81d0d97d87e471c91ffa8b1428388db770e88c762a26820386fcdddc6169e3`.
- `browser-receipt.json` has `result=passed` and the same release/revision/run;
  the acceptance record binds receipt SHA-256
  `803c237a7fef17306f63d6d839bd3a7f2eba188449f49dfa0f11ea75f85de52f`.
- `pending-current.json` is absent. The new release's `rollback-command.sh`
  exists with mode `0700`. Earlier accepted-image/retained backup evidence was
  not removed.
- Actual `evo-crm-app-1` container `63f67e7de349` has the matching image/revision
  and version above. App and `evo-crm-clamav-1` are healthy, with zero restarts.
- Normal verified-TLS request from the VPS to
  `https://evo-crm.72.62.119.112.sslip.io/api/health` returned HTTP 200 and
  `{"ok":true,"status":"live","service":"evo-crm"}`. DNS/TLS was not changed.
- `EVO_PRODUCTION_RELEASE_ARMED=false`, confirmed using a fresh GitHub API read;
  variable `updated_at=2026-09-09T19:00:06Z`. Do not leave the lane armed.

At `19:03:01`, a fresh aggregate-only transaction with
`transaction_read_only=on` confirmed:

| Source fact | Result |
| --- | --- |
| Migration ledger | Exactly 001–138; missing 0, extra 0 |
| Sales / targets | 209 / 4 |
| Auth identities / active Platform Admins | 2 / 1 |
| Student memberships / Student profiles / cases | 0 / 0 / 0 |
| Clients / leads | 0 / 0 |

No account, business row, lease or database role was created by this readback.

## Actual localhost view

The existing owner Chrome session was reloaded after deployment, not signed in
through an Auth bypass. `http://localhost:3000` is the same production app through
SSH, not a local Next server or a separate database. At verification:

- Listener process `63797` binds `127.0.0.1:3000` and forwards through Hermes to
  `172.16.8.4:3000`.
- The newly accepted app's actual `evo_crm_private` address is `172.16.8.4`.
  No tunnel replacement was needed. Addresses/process IDs may change later;
  verify them before reusing this note as operational instructions.
- The existing local preview on port 3100 was preserved and is not this release
  view. Nothing was deleted to achieve the one-permanent-source requirement.

Read-only checks on the actual new app, using the existing active Admin:

1. `/v3/profile`: EVO brand, `Поступление`, four healthy zero-valued metrics and
   `Рабочий список`. Empty state correctly says cases appear after Sales handoff;
   it does not show a source-error placeholder.
2. Clicked China and Malaysia: `direction=CN` and `direction=MY`, respectively.
   Expanded additional filters, selected `Есть просрочки`, submitted the GET
   search and verified `attention=overdue` with Malaysia retained. Reset restored
   the unfiltered empty state.
3. Expanded `Короткий отчёт по направлениям`; its current-state/monthly-arrival
   explanation rendered. Submitted September 2026 and verified
   `/v3/profile?period=2026-09`. With zero cases, no populated direction rows were
   expected or claimed.
4. Opened Main and `Отчёт продаж`: September 2026 displayed six existing sales
   rows and target 35. This period count is not the total 209 source rows.
   No sale, target or import control was submitted.
5. Returned to `/v3/profile` and marked the tab as the owner's deliverable.

## Deliberate limits and next actions

- The owner explicitly deferred a new backup/export and its isolated recovery
  rehearsal for this evaluation release. Neither was performed or marked PASS.
  Existing backups remain retained. Image rollback does not undo migrations;
  older UI cannot perform all newly versioned playbook operations after binding.
- No production Student identity exists. Normal Admin release smoke and empty
  staff surfaces do not prove a real production invitation or private Student
  assessment journey. Earlier E4/E5 and invitation proofs remain isolated proof,
  not live Student evidence. No new synthetic user/case, Admin impersonation or
  permission bypass was introduced to manufacture that evidence.
- There is one working Platform Admin and a second legacy Auth identity without
  Platform membership. Both identities and their ownership are preserved. The
  exact account-retention/deletion target remains a separate owner clarification;
  no password, role, account or owned data was changed in this release.
- Owner UX/business feedback remains open in [#693](https://github.com/izzhackt/evo_AI_CRM/issues/693).
  Future English calibration and ORVIS audience review are separate from native
  screening v1. Do not advertise a validated CEFR certificate.
- No WhatsApp/amoCRM activation, external message, repeated Sales import or
  deferred cleanup [#687](https://github.com/izzhackt/evo_AI_CRM/issues/687) occurred.
- A later docs-only main must not be called the deployed image. Recheck the
  accepted pointer/image for live identity; do not redeploy solely for this note.
