# A15e / direct quotes227: verified local API and database behavior

21 September 2026. Runtime source `7a54f4e3cc564d0e02797ebde932e3d6f28833d9`, base main
`d02d15b75919dcca94b79c0e3efdd05da0f3b701` (includes ROOT32 PR985).
Contract: [accepted precode](../EVO_TEAM_CHAT_DIRECT_QUOTES_PLAN_2026-09-21.md),
merged PR986 / `418521f5b43a1461af11be01b6169430c21f2a6e`.

Actual local apply/API QA used integrated source
`ec18763c96e60870a9fcc8baa4f24635d51f8ca4`, including accepted B226 merge
`28613990d3b3ba3b66053571cc3c6e8391cc35e7`. All six runtime/test files remained
byte-identical to independently reviewed `06198eea`.

**Migration227 was applied once to the coordinated local test database and
the bounded ordinary-Auth/API scenario passed. UI, server-action, native,
provider and production behavior remain outside this evidence.**

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

These source checks were performed before the main integration and are reused
for unchanged runtime bytes, not reported as a new run. Independent source
review approved06198eea; protected CI35558215610 passed at that earlier head.
The final evidence head still requires its own protected CI and exact-head review.

## Actual coordinated local evidence

B226 released the shared local window after its accepted merge. A fresh READ
ONLY snapshot matched its complete raw-row release for all282 current business
tables, including226 columns. Source/config/CLI/observer/actor-history bindings
and the own-session logout delta received independent approval before execution.
ROOT's conditional authority covered one local CLI apply and, only after exact
apply PASS, the already bounded QA scenario. No production action was performed.

The single CLI apply exited0. Verification preserved every old business row,
function body/metadata/ACL and ledger prefix. The initially empty private quote
table added exactly one table, seven catalog columns (four table plus three
index columns), one PK index, four constraints, eight internal FK triggers,
two functions and one ledger row. Local config advanced to001–227 only after
these checks passed.

Existing ordinary Admin, Sales and Student signed in and passed actual actor,
staff and channel-scope readiness. The retained56 A223 messages were read without
rewriting them. **43 prewrite negative cases** had zero effects, including
anonymous/Student/scoped-channel denial and malformed input/target cases.
No other existing organization was available: cross-tenant execution is not
claimed. No identity or role was created or reset.

Exactly **six effective commands** created a V2 root R, a V1 reply L to R,
a V2 reply D quoting L and a V2 reply E quoting D, then edited and deleted only
the new L. Two concurrent identical D requests returned the same result and
created one effect. All post/edit mentions were empty; notifications, sparse
seen rows, preferences and old messages were unchanged.

Frozen requests replayed after target edit/deletion without new effects.
Three additional conflicts returned40001: a different direct target under
the same root, V2-to-V1 request reuse, and V1-to-V2 request reuse. A page excluding
L projected its current edited Unicode preview and then an empty tombstone.
Retained off-page legacy-root fallback, V1 thread/search/timeline and all four
V2 page modes were exercised. Production decoders accepted **nine V2 receipts,
six V2 pages and two V1 pages** captured from these real calls.

Final reconciliation covered283 business tables: exactly four new messages,
two quote mappings and six new receipts/changes/audits, with all prior rows
preserved by full-row hashes and only the exact owned IDs excluded. Catalog,
other business data and Auth user/identity counts remained unchanged. All three
own sessions were logged out using scope=local with204 responses before token
discard. Session-row equality is not claimed. No browser or app server was
started. All188 evidence-file hashes were checked after the run.

## Private evidence receipts

These local files contain the reproducible snapshots and command receipts;
private row values and tokens are not copied into Git.

| Evidence | Local path | SHA256 |
|---|---|---|
| B226 full raw release | `/private/tmp/evo-b226-write-qa/release-receipt.json` | `bcb7ed6db93f0bf21ed91fb41e9032e7cc67ccb767757325f77e9337f8ae74cf` |
| Fresh226 baseline | `/private/tmp/evo-a227-final-binding-20260921/fresh-baseline226.json` | `79ed76f4264228f8f52b55724a8bdabfeea94215f03dd083bccfaf9e7a8c062e` |
| Independent final binding review | `/private/tmp/evo-a227-final-binding-independent-review.md` | `151fa95dc440330cec1bba3ccd3ca60faf3953c33639e4962cf7fe2af481e2c0` |
| Actual227 apply | `/private/tmp/evo-a227-apply-20260921/apply-receipt.json` | `0fb6ce3702497488edebea2b16e3084360c601a63d8ad6bb82721abca9664406` |
| Actual bounded QA | `/private/tmp/evo-a227-local-qa-20260921/qa-receipt.json` | `a16cc76d9fc51144d02d8df06d3a16028df72626630d5fe922b3c1f51f6381e2` |
| Verified final candidate | `/private/tmp/evo-a227-local-qa-20260921/verified-release-candidate.json` | `5f6950eaca9e411cb422bc59471cc22a1c9516e6d72419f4b7ea8123d2511a30` |

The QA receipt deliberately remains released:false. Final independent evidence
review, protected CI/merge and a fresh complete raw release to ROOT990 are the
remaining handoff gates. A15f UI hookup starts only after227 is merged; neither
this backend result nor its technical QA completes all of product item15.

## Source hashes

| File | SHA256 |
|---|---|
| `supabase/migrations/227_platform_team_chat_direct_quotes.sql` | `1f8eee9b8b78f74e554311cb734d25f295e2177cd755176ac2f2d52af636268a` |
| `src/lib/platform-team-chat-post-v2.ts` | `ef9a19ee726ee4d382f2871fe1e4923586ba4e01587bec304999465b5ec4d40b` |
| `src/lib/platform-team-chat-timeline-v2.ts` | `e386d3021c2b67674911b25fbf1fe9e45a6d2512b3e5bfef621f3068ce293cfa` |
| `src/lib/platform-team-chat-v2-actions.ts` | `ce1117afe1146fd1cf08824c32a1f49b8f0ddd8e29548dd28bb652852f9ab1b0` |
| `src/lib/server/platform-team-chat-v2-repository.ts` | `d820824aa972ddab707f3f34c531131833c67d7b32ae21d512237444a15100b4` |
| `tests/team-chat-v2.test.mjs` | `c729e0b72ca384388a98bdeeeb70fc10e0bf1d554624b2457fb8c6a5ce5c8316` |
