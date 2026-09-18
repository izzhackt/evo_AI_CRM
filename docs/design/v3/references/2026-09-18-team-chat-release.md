# Team chat Messenger release — 18 September 2026 (Dubai)

Owner selected Messenger option2 and then explicitly clarified that the global
left sidebar must not change. AppShell remains identical to the previous main;
only the chat workspace adopts the channel list, message bubbles and anchored
composer. Both requested explanatory strings and mute functionality are removed.
History, read cursors, permissions, threads and realtime are preserved.

## Code and focused validation

- [PR823](https://github.com/izzhackt/evo_AI_CRM/pull/823), independently approved
  at `104fbd718c84f0a80da8440206948b1bac44f28a`.
- Merged revision: `3b657b309a46c64269ebe90b7967740d18d67ff7`.
- [PR checks35288476193](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35288476193)
  passed: build48s, lint56s, scoped migration9s, release source contracts70s.
  No full PostgreSQL replay, broad E2E suite or external-provider checks.
- Local changed-file lint and14 focused checks passed. Real authenticated local
  desktop/mobile observations are recorded in root `design-qa.md`, separately
  from source/harness tests. No staff messages, accounts or tasks were created.
- An earlier source assertion mistook `supabase/migrations/` for a CLI command;
  its command-only correction passed before merge. No failing check was bypassed.

## Schema

- Exact-main [check35288633222](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35288633222):
  local171, remote170, only171 missing and no extra versions.
- Exact-main [apply35288680719](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35288680719):
  dry-run and apply listed only `171_platform_team_chat_remove_mute.sql`;
  completed at23:52:19 UTC, readback contained001–171.
- Function replacements preserve migration156 dynamic staff permissions. They
  remove mute commands and ignore historic mute values for mention notifications.
  No message/preference data or schema objects were deleted. Reviewed SQL and
  applied migration evidence are not a separate live catalog/grant audit or a
  claim that a new employee notification was delivered.

## Production

- [PR825](https://github.com/izzhackt/evo_AI_CRM/pull/825) aligns the duplicate
  lightweight-main command guard; independently approved at
  `07f7b1a860843e6453ee81565c6c68f7607bd8f5`. Exact three main checks passed
  locally; [PR checks35288916248](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35288916248)
  passed. Earlier main run35288769841 stopped before app deployment; its release
  arm was disarmed before the correction. No production check was bypassed.
- Combined release includes the separately reviewed [PR824](https://github.com/izzhackt/evo_AI_CRM/pull/824)
  with59 university photo replacements. Its full image sweep remains incomplete;
  this chat receipt does not claim all university images were visually verified.
  The photo task separately confirmed live existing QA Student AGH and INTI cards:
  updated captions/sources, decoded1280×964 and2560×1440 respectively, plus visual
  confirmation of the INTI pool card. No complete143-image/mobile sweep is claimed.
- Exact released revision: `600e11416e0dff7021167253400d9fe72ffd11cc`.
- [Light main CI35289078479](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35289078479): success.
- [Managed release35289102489](https://github.com/izzhackt/evo_AI_CRM/actions/runs/35289102489): success.
- Release ID: `v3-r35289102489-a1-600e1141`.
- Image: `sha256:3967a807debd9ac5737a491e17c7828446070d2d2950048861b077f9040cd352`.
- Acceptance record SHA256: `8a4e3cb8b3d6681b43a963e4721bb36ceddbd507eb7bdc7e383c1d876bb2db23`.
- Actual authenticated Admin team-chat smoke passed at00:02:11 UTC; existing
  Admin case and isolated Student portal journeys also passed. No staff messages,
  accounts or client records created for proof. This is not notification-delivery
  or WhatsApp/amoCRM acceptance.
- Fresh SSH readback00:03:39 UTC confirmed live/accepted revision and image,
  matching acceptance hash, healthy container,0 restarts and no pending pointer.
  Both CRM and Student public HTTPS health endpoints returned200. Arm readbackfalse.
- Optional post-release desktop Chrome tab reached the chat URL/title but control
  reads timed out; no second manual production screenshot proof is claimed.
  Local desktop/mobile visual checks and CI production browser evidence are
  separately described above.
