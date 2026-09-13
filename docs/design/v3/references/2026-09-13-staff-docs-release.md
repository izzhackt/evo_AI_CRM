# S1 staff directory and D1 private preview — release evidence

Date: 2026-09-13. Release status: exact-main CI failed; correction in progress,
release arm false, prior accepted application unchanged.
This closes only S1 organization metadata and D1 private document preview,
not dynamic multi-role authority, real employee onboarding or EVO Docs retirement.

## Reviewed source and working checks

- Independent review approved exact candidate
  `bf227fefe082d14fe58ea01cb3cd7e5a30282d9c`, including final evidence limitations.
- [PR741](https://github.com/izzhackt/evo_AI_CRM/pull/741) merged as
  `251dbdc5faf38961224b7755d545ba496e485ad4`. Its tree matches the reviewed candidate.
- [Fast checks34730057643](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34730057643):
  changed range, release contracts, lint, build, migration boundary and aggregate PASS.
- Actual isolated SQL/Auth/Storage/scanner/UI checks and their limits are in
  [the working report](2026-09-13-staff-directory-working-check.md).

## Cleanup — complete

Only the owned temporary environment was removed: eight named containers,
three named volumes, one private network and the Next runtime on3110. Temporary
technical accounts/data and seven private runtime/trace files were deleted without
a backup, as authorized. Sanitized evidence and screenshots remain outside Git at
`/tmp/evo-s1d1-0qOF30`; exact inventories are `cleanup-runtime-receipt.json` and
`cleanup-file-receipt.json`. The original local foundation remained at125 with the
same container/start time. Existing SSH tunnel3000/PID7065 was not changed.
Shared images, production resources and standalone EVO Docs were not deleted.

## Managed schema — complete

- [Check34730312761](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34730312761)
  read154 local migrations and153 managed migrations; only154 was missing,
  with no unexpected managed versions.
- [Apply34730362417](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34730362417)
  used the existing official linked flow and dry-run. Only
  `154_platform_staff_organization_directory.sql` was applied; readback is001–154.
- This additive change creates organization metadata, not employee invitations,
  role grants, Auth accounts or production fixtures. No new backup/rehearsal was
  performed under the standing owner direction; retained recovery data is preserved.

## Release preflight

Independent read-only Hermes check at01:18–01:20UTC passed. Prior accepted
revision `4e35b896e16449a63bd11bffd457ddf4acac6c62` matched the app image, immutable
acceptance record and browser receipt. Pending pointer was absent; app, WAHA and
ClamAV were healthy with zero restarts and private services had no published ports.

Preservation baseline:

- WAHA container `0d1017e3304dfb3e1dce37ca00a2826b019429266763e211ed399b938baaa750`;
  volume `evo-crm_evo_crm_waha_sessions`.
- ClamAV container `7242869f04f446d677339f23271b21dce7a1d2e18c5af6054d6b1c69bdac81fd`;
  volume `evo-crm_evo_crm_clamav_signatures`.
- SSH tunnel `127.0.0.1:3000` targeted the previous app private IP
  `172.16.8.4:3000`; recheck the target after replacement.

Actor ID72846050 matched the authorized GitHub operator. The release arm remained
false during schema preparation and was enabled only after schema/preflight passed
while exact-main [CI34730314289](https://github.com/izzhackt/evo_AI_CRM/actions/runs/34730314289)
was still running on `251dbdc5faf38961224b7755d545ba496e485ad4`.

## First exact-main CI — failed, not released

CI34730314289 passed admission, Node/static and dependency audit. Browser proof
ran20 tests:15 passed,2 existing conditional skips,3 failed. New S1 passed.
The broad document flow successfully uploaded/downloaded/previewed version2 PNG,
then a later Admin assertion still expected the former PDF filename. Its failure
prevented writing the acceptance receipt required by the following D2 test.
The separate company-file upload returned503 instead of201; cause remains under
investigation. Do not claim the full workflow passed or suppress these failures.
Release arm was reset tofalse immediately; no app replacement was attempted.

The correction changes only the stale expected filename and includes a bounded
flat machine error code in the company-upload status assertion. It keeps201,
all byte/preview/access checks and no automatic retries. ESLint, TypeScript and
diff checks passed; a static filename-consistency check is red on251dbdc5 and
green on the correction. This narrow static check is not a replacement for the
real full browser gate. Release34730599728 was skipped after failed CI.

## Pending completion evidence

Record full CI outcome, release run, immutable acceptance/image/browser identities,
post-release health, arm=false, pending absence, preserved services and read-only
production staff UI proof here after actual completion. Do not infer any of these
from a successful build or schema apply.

## Remaining business scope

Custom editable roles and multiple scoped role assignments, real recipient/rights
confirmation and invitation delivery remain open in the employee plan. Structured
profile extraction/export, Gemini processing, versioned forms/packages, legacy data
mapping and accepted cutover remain open in the Docs plan. No real customer files
were opened/uploaded for this release and no provider success is claimed.
