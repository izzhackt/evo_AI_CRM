# A15c — actual local flat-history reader QA

**PASS within the local technical scope below.** The UI still uses its existing
reader/composer. This does not complete item15, claim production delivery or
claim real-customer acceptance.

## Exact source and execution

- Runtime source: `9c5899383e092b0dbcf043be4f270049251de8a1`.
- Actual successful QA HEAD: `c37d862879d0ef829d449cf92607f9cc947abdb6`.
- Migration223 SHA256:
  `089e5c023ebdf8cf05c19c64256463113c12caf13f66a15212595cb85054b7e2`.
- Reviewed apply v2 script:
  `af6789ae4c5f3db45205ba48b9aba5fcd9ac491926bb29a1ce5a10e1a62a55a4`.
- Reviewed QA-only v5 script:
  `d44988d371504fe9a7028730480fa0abc7ce11eb9999d64ff4a5ec0ac588a622`.
- Actual-response decoder helper:
  `a2ae05af7c0f11b0464405a0de66fd5485b7210dd0ffd9dba7656cd4c2276157`.

Independent precode/source/packet reviews and ROOT's exclusive local window
preceded execution. Only the pinned local Unix Docker endpoint/container/project
and ordinary local Auth were used. SQL223 was applied **once**, without business
DML. Old function definitions/attributes, index/column metadata, grants, policies,
triggers and ledger rows were preserved; the only additions were the reviewed
reader/index/ACL and ledger223. All281 business tables and Auth identity counts
were unchanged by apply.

The subsequent merge of main`c5d9a4cf` preserved its complete shared-plan prefixes
and A's append suffixes. All four A15c runtime/test/SQL files remain byte-identical
to9c589938. Existing offline evidence is reused for those exact bytes:9 decoder
contract checks, scoped ESLint, Next typegen+TypeScript and SQL/PLpgSQL parse PASS.
These are not relabelled as new executions after the merge.

## Actual ordinary-Auth proof

The existing Sales account was resolved through actual password Auth,
`current_actor_authority` and `staff_access_snapshot`. User/profile/membership/
organization IDs match the pinned metadata preflight. Its real scoped identity
is non-admin `staff`, with a nullable legacy coarse role and the existing Sales
Manager assignment. Exact assignments/access version and general/sales channel
permissions matched; admissions was denied. The distinct existing Student was
positively resolved as Student and had no staff snapshot.

Before writes,17 negative cases passed with actual responses saved privately.
They cover Student/anonymous access, denied/NULL channels, unsupported modes,
invalid cursor values/combinations and a missing context anchor. Observed pairs
were400 with22023/22P02/22003,401 or403 with42501, and500 withP0002. The latter is
the documented [PostgREST v16 mapping](https://docs.postgrest.org/en/v16/references/errors.html#http-status-codes);
only the exact expected P0002/500 pair was accepted, never a generic500.

## Actual populated history

ROOT approved retaining clearly labelled local QA messages. All history was
created through the existing ordinary `team_chat_command` with frozen request
IDs and empty mentions, never SQL inserts or mocked RPC responses:

- 55 general messages, including replies at positions2,4 and55 to original roots.
- 1 sales-channel control message.
- 1 edit of original root1 and1 tombstone of root3, each at expected version1.
- 1 replay of the completed original post request: identical receipt, zero
  additional changes.

That is56 retained messages,58 effective commands and one replay. Each effective
command produced exactly one scoped change, receipt and audit. The edit and
tombstone retained original IDs/authors/timestamps/parent links; other messages
remained unchanged. Existing private Realtime invalidation occurred normally;
there was no provider message or staff mention notification.

Actual reads verified:

- latest positions6–55 plus before positions1–5 reconstruct all55 originals,
  with no duplicates or gaps;
- after position27 returns28–55; context28 returns3–52; boundary context2
  returns1–26; deleted-anchor context remains readable;
- sequence cursors come from actual returned values, not assumed ordinals;
- off-page root1 quote reflects its edited body/version; deleted root3 text and
  mentions remain redacted, including its quote, while reply4 survives;
- sales-anchor lookup from general returns not-found; empty boundaries stay empty;
- unchanged v1 root/thread/message reads retain their original IDs and semantics;
- change watermark matches the unchanged changes reader at a no-writer boundary;
- 19 actual timeline pages pass the real decoder. Each request was repeated with
  equal response, and full281 state hashes around read phases stayed equal.

Every pre-existing row was preserved, including the four affected tables after
excluding exactly the owned IDs/requests. The remaining277 business table hashes
are identical. Preferences, stored read sequences and existing staff notifications
are unchanged. The author's derived unread remains0 because the current reader
excludes own posts. Schema/ledger and Auth user/identity counts are unchanged by
QA. Ordinary sign-in sessions changed; session equality is not claimed.

## Preserved failures and limits

Three earlier attempts stopped before any command: unavailable second-Sales
credentials, a stale coarse-role expectation, then an overly narrow HTTP-status
assertion. All original packets/failure receipts remain preserved. Each stop had
confirmed full parity and zero messages; none was called successful history QA.
The [packet record](crm-team-chat-flat-reader-223-packet-2026-09-21.md) explains
their corrections and exact boundaries.

- Second-Sales observer login is unavailable. Other-author unread54/1 and that
  observer's reads are **not claimed**; no account/role was created or reset.
- No second real local tenant existed. Cross-tenant refusal was **not exercised**.
- No UI cutover, sparse-seen accounting, shared quote composer, native iPhone
  interaction, production migration or managed release was performed here.

## Private receipts and released state

The single apply receipt is
`/private/tmp/evo-a223-local-qa-2026-09-21/apply-receipt.json`, SHA256
`5d7630913bcf9899378c730a738103ff77bd4a6d2d72217512ee6be73b6004ea`.

The successful QA/release receipt is
`/private/tmp/evo-a223-local-qa-v5-2026-09-21/qa-receipt.json`, SHA256
`8f6966b71e8e94da55d80510cfb349a10936b9628b747ad6da8b8495304f3379`.
It includes the actual final full state, checks, owned IDs and evidence hashes.
Credentials/tokens and raw private evidence are not committed to Git.

The exclusive writer was explicitly released. No A browser/server was started.
Next sessions must baseline schema001–223 and the intentionally retained56 QA
messages; do not compare against the earlier empty history or repeat this packet.
