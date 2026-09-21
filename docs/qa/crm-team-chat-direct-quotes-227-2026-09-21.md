# A15e / direct quotes227: source validation, awaiting actual local QA

21 September 2026. Runtime source `7a54f4e3cc564d0e02797ebde932e3d6f28833d9`, base main
`d02d15b75919dcca94b79c0e3efdd05da0f3b701` (includes ROOT32 PR985).
Contract: [accepted precode](../EVO_TEAM_CHAT_DIRECT_QUOTES_PLAN_2026-09-21.md),
merged PR986 / `418521f5b43a1461af11be01b6169430c21f2a6e`.

**Source implementation only. Migration227 is not applied. No actual RPC,
Auth, server-action, UI, native or production acceptance is claimed here.**

## Changed behavior

One closed private quote map stores only IDs. Additive `team_chat_post_v2`
derives a legacy-compatible root parent from the selected direct target, keeps
current scoped mentions, and writes the existing message/change/audit/receipt
path with invalidation-only Realtime. Canonical receipt identity includes the
exact direct target plus server-owned schemaVersion2/operation/channel. It
shares171 request→channel locks and checks replay before revalidating the target.
V1 and V2 requests cannot silently reuse one request ID for different operations.

Additive STABLE `team_chat_read_timeline_v2` delegates page selection to223,
then projects only the bounded page's effective direct targets from current
originals. It retains root parent/order/cursors/watermark/context. Tombstones
contain no old body; edits are not copied into a quote cache. Explicit count
checks reject incomplete projections.

New SSR repositories/actions require an ordinary authenticated actor, reject
staff preview and check the existing channel permission. No service-role path
or V2→V1 fallback. The pure V2 decoders require an explicit version/quote field,
exact envelope, matching request/channel/direct target, positive int64 strings,
ordered bounded pages, current in-page original consistency and safe tombstones.

The six runtime/test files are additions only. Existing171/223/225 SQL, V1
command/decoder/readers, UI/composer/drafts, search and seen paths are unchanged.
No legacy row backfill. V1 continues root discussion; direct-target rendering
will be wired separately in A15f.

## Checks actually performed

- Node22.23.1: `node --experimental-strip-types --test tests/team-chat-v2.test.mjs tests/team-chat-timeline.test.mjs` — **16/16 PASS** (7 V2 +9 unchanged V1 decoder tests).
- Scoped ESLint on the four new TypeScript files — **PASS**.
- `tsc --noEmit --incremental false` — **PASS** after standard ignored Next/image type references were generated in the fresh worktree. Initial run lacked `next-env.d.ts` and reported the existing EvoLogo PNG type import; no tracked source change was needed.
- pglast7.7: SQL outer parser **9 statements PASS**; both complete CREATE FUNCTION statements also pass `parse_plpgsql`. This is syntax evidence, not execution against the database/catalog/RLS.
- `git diff --check` — **PASS**.
- Dependencies reused only after matching package-lock SHA256 `86fc8affba3bce2c732ea4e1c5b51b9f34601819b6ffab9eee6b950b7ec570e0`. Test/lint/typecheck commands used Node22.23.1 explicitly.

Decoder examples are pure malformed/current wire-contract fixtures. They do
not stand in for Auth, SQL effects, idempotency, concurrent writes or UI use.
Protected CI and independent exact-head source review remain separately required.

## Required next evidence

ROOT owns local DB/Auth/UI coordination; B owns226, A owns reserved227. Do not
apply227 before actual226 release, current source integration, fresh full-state
baseline and independently reviewed single-use apply/QA packets with ROOT GO.
Current source review can proceed offline while B works.

The precode's bounded QA remains four new labelled posts (V2 root, V1 reply,
V2 quote of that reply, V2 quote of the preceding reply), then edit/delete only
that new V1 reply: six effective commands, four message rows and two map rows.
Freeze empty `mentionedMembershipIds` on all effective post/edit inputs; delete
has no mentions field in the unchanged V1 contract. All posts and the edited
row therefore have empty mentions; notifications are outside the effect budget.

Exercise identical concurrent requests, exact replay after target changes,
same-root changed-target conflict and V1/V2 collisions using retained intents.
Decode actual responses, verify quotes of an edited/deleted target outside the
page and retained old context, preserve all old seen/read/receipt/message state.
Negative ordinary Student/anon/forbidden-channel and malformed calls must have
zero effects. No new identities, role resets or known-invalid salesOther login.

After226, enumerate actual current tables/catalog rather than assuming282.
Expected additive227 objects: one private table/RLS/closed ACL, one PK index,
four table plus three index catalog columns, four constraints, eight internal
FK triggers, two new functions and one migration ledger row. No replacement of
existing function bodies/ACL. Reconcile any uncertain write before retrying.

## Source hashes

| File | SHA256 |
|---|---|
| `supabase/migrations/227_platform_team_chat_direct_quotes.sql` | `1f8eee9b8b78f74e554311cb734d25f295e2177cd755176ac2f2d52af636268a` |
| `src/lib/platform-team-chat-post-v2.ts` | `ef9a19ee726ee4d382f2871fe1e4923586ba4e01587bec304999465b5ec4d40b` |
| `src/lib/platform-team-chat-timeline-v2.ts` | `e386d3021c2b67674911b25fbf1fe9e45a6d2512b3e5bfef621f3068ce293cfa` |
| `src/lib/platform-team-chat-v2-actions.ts` | `ce1117afe1146fd1cf08824c32a1f49b8f0ddd8e29548dd28bb652852f9ab1b0` |
| `src/lib/server/platform-team-chat-v2-repository.ts` | `d820824aa972ddab707f3f34c531131833c67d7b32ae21d512237444a15100b4` |
| `tests/team-chat-v2.test.mjs` | `c729e0b72ca384388a98bdeeeb70fc10e0bf1d554624b2457fb8c6a5ce5c8316` |
