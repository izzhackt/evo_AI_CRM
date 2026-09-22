# A15 — visible channel timestamp: source verification

Source: `4e434eee1d91ed3d4f3b7cbe4e7bbc0ff8042d5b`, based on accepted
main `2a04610f8a52c4c187c162dc687fddc643344b22` / reader239 in #1027.
This receipt covers source checks only. New rendered UI, real employee
acceptance, production, native and full item15 are not claimed.

## Contract and review before code

[UI plan](../EVO_TEAM_CHAT_CHANNEL_TIME_UI_PLAN_2026-09-22.md) and both journal
appends were committed before implementation at
`7692a242383ba7122901b6ca73547999728d601c`. The reviewed plan SHA-256 was
`3843d0c589a33575396935d3cb14dd91df08e65021ea3719575288ff03258199`.
Independent review: APPROVED_PRECODE; report SHA-256
`a7a5f4d2a29595a25e409b1f42c6169ebfd263b621047034989e0f647b1c4599`.
The parent read the complete report before editing. Impeccable Operate preserves
the incumbent EVO rail; craft-floor was read immediately before the UI patch.

## Implemented behavior

Channel rows use the accepted `latestPreviewCreatedAt` with no new request or
migration. A pure formatter reuses the unchanged strict UTC6 normalizer. The
visible `dd.MM HH:mm` uses explicit ru-RU/gregory/latn/h23 and the organization's
Asia/Bishkek zone. Full year and calculated zone offset remain in both the title
and screen-reader text; `<time dateTime>` retains all six fractional digits.
Missing/null/invalid values produce no time. Whole-second parsing for the
minute label cannot round microseconds into the next minute.

The existing name and time share a baseline. The name can ellipsize; time and
the separate unread badge do not shrink. Preview, link target/handler, selected
state, focus, rail width, avatars, message actions, drafts, transport and seen
logic remain unchanged. Actual geometry and accessibility remain unverified.

## Checks actually run

Node `22.23.1`; all commands exited0:

```sh
node --conditions=react-server --experimental-strip-types --test tests/team-chat-channel-time-label.test.mjs
node node_modules/eslint/bin/eslint.js src/components/v3/team-chat/TeamChat.tsx src/lib/team-chat-channel-time-label.ts
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

The formatter tests passed7/7 in one run. They exercise the actual pure formatter:
Bishkek day/month/year rollover and leap day, midnight00, equivalent offsets,
canonical UTC6 preservation, no microsecond rounding, absent/malformed input,
and process-zone independence across UTC, Los Angeles, Kathmandu and Kiritimati.
These are contract examples, not runtime messages or substituted UI data.
Unchanged43 reader tests were not repeated.

Raw log SHA-256:

- Tests: `6e4fffa37b7c218ecd5430a5dfaf5dd2d61b725f167f8d21dbd59d359d950004`.
- ESLint, no findings: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Type generation and TypeScript: `adba4af9194e10e47dda75ff0fd0f8c2b756474896d0eba5612799c527ff372a`.

Private raw logs and `source-checks.json` are retained in
`/private/tmp/evo-a239-channel-time-ui-source-20260922/`; no secrets or runtime
data were collected. Dependencies were reused from the accepted reader
worktree after exact package/lock equality, same ownership and a regular donor
directory were verified. No install, full build, browser, server, Auth or SQL
operation occurred. Only small local generated type artifacts were created.

## Acceptance required at the source checkpoint

This is the historical sequence before the actual batch; it is not a current QA
assignment. The dated completion below supersedes its pending statuses.

Independent source review and short protected CI precede a separately admitted
actual UI batch at1440/390/320. Shared QA remains with ROOT16b, then B1029, then A
when ROOT assigns the window. Preserve existing state, bound any seen effects
to admitted existing IDs, and close only owned resources. Check real labels,
semantic/full accessible time, overlap/overflow, keyboard/Back and directly
affected draft/search/context continuity. Missing old-year/tombstone/other-role
material remains an explicit gap; do not create messages to manufacture it.

## Completion update — 22 September 2026

Independent source review `449fa0fc` and protected CI35676395214 passed on
`c1fcda9b`. One ordinary Admin actual batch390/320/1440 and strict closure were
accepted by independent review `669af3dc`; ROOT release `d21f93bc` returned QA
ownership. [Actual receipt](team-chat-channel-time-ui-actual-2026-09-22.md) records
the preserved zero-seen STOP, separate finite51 admission, actual seen0, exact
proof hashes and desktop name ellipsis limit. The source checks above were not
rerun. Fresh main `ac165cf9` integration preserves all four A code/test bytes;
final integration review, CI and PR #1030 merge are still separate steps.
