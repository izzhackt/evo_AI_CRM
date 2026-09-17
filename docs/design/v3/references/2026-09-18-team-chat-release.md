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

Release and authenticated smoke are in progress; do not treat this draft as
production acceptance until exact runtime and accepted-pointer evidence is added.
