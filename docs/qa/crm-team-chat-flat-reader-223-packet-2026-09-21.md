# A15c / migration223 — proposed local QA packet

**223 applied once locally; first QA attempt stopped before commands. Revised
two-actor QA packet review and a fresh ROOT exclusive writer GO remain required.**
This document specifies the bounded operations for review; it is not an apply
receipt or positive reader acceptance. No production/provider action is included.

Source: `9c5899383e092b0dbcf043be4f270049251de8a1`.
SQL: `supabase/migrations/223_platform_team_chat_flat_reader.sql`, SHA256
`089e5c023ebdf8cf05c19c64256463113c12caf13f66a15212595cb85054b7e2`.
Precode55109f62 independently approved; ROOT recorded migration223 reservation.

## Offline evidence already obtained

- SQL AST:7 statements; PL/pgSQL parse:1 function — PASS. This does not prove
  actual relation binding, execution, query results or RLS/ordinary Auth.
- `tests/team-chat-timeline.test.mjs`:9 contract tests PASS, including bigint
  precision, unordered UUIDs, sequence gaps,50-row bounds, exclusive before/after,
 25/anchor/24 context, required quotes, deleted text and Unicode bounds.
- Scoped ESLint and standard Next typegen + tsc --noEmit --incremental false PASS.
- Existing v1 chat source/commands/read/prefs/UI are unchanged. Existing evidence
  may be reused for those unchanged paths, with its original revision/limits.

## Apply boundary

Only `/private/tmp/evo-database-foundation.WhSt8z` local project
`evo-local-0fd3559d0240c989`, API `http://127.0.0.1:57495`.
Require ROOT to release B's writer and identify the current release receipt before
any Auth or database work. No comparison against pre-B business data.

The actual executable packet must be presented with its immutable script hash
before GO. It must pin local Unix Docker endpoint, context orbstack, running
container ID/name/project/workdir labels; reject remote Docker overrides; use the
same verified endpoint/environment for every command; check exact source and SQL
hash, ledger001–222 and absence of223/new function/index. Capture a fresh full
business/Auth-count/schema/function/ledger baseline under the exclusive window.

Apply223 once, with truthful ledger recording in the same transaction. Verify
exact new function/index/ACL and unchanged existing functions/metadata/business
rows before beginning fixture commands. On uncertain execution, stop and inspect
ledger/source hashes; never rerun DDL blindly. No reset, seed, role/Auth creation,
policy bypass, bulk truncate, provider or production connection is permitted.

## Proposed positive history operations

The last A15b receipt had zero global staff messages. Recheck that precondition
before any fixture writes; if it no longer holds, pause this packet for review
instead of mixing unrelated history into these expectations.

Use the **existing ordinary local Sales Auth identity** and its currently
permitted QA organization/general+sales channels. Verify the allowed-channel set
and baseline first. Keep tokens process-only; no service-role substitute, new
identity, role assignment or direct SQL insertion of history. Store all prepared
request UUIDs, exact inputs and resulting message IDs in an owned0600 manifest
before/after each action. Bodies explicitly identify their local A15c QA purpose;
mentions are always empty and no person is contacted outside the local instance.

Exactly these intended mutations through the existing real team_chat_command:

1. General:55 posts in order. Positions1 and3 are roots;2 replies to1;4 replies to3;
   positions5–54 are roots;55 replies to1. Every remaining parent is null.
2. Sales:one root post, used only for cross-channel context refusal.
3. Edit own general root1 once with expected version1; verify its current quote
   reflects the edited body/version, including when root1 is outside latest50.
4. Delete own general root3 once with expected version1; keep its tombstone and
   reply4. Verify no deleted body/mentions in the message or quote projection.
5. Replay one completed post with its original request ID and byte-equivalent
   input; expect the existing receipt and **zero** additional mutation.

That is **58 effective commands**:56 posts,1 edit,1 delete; plus1 replay.
No read/mark-seen command, moderation, reaction, task, mention, staff notification,
Auth settings or permission mutation. If a command outcome is uncertain, retain
its exact frozen input/request ID and stop for reconciliation; never invent a new
request ID as a retry. No automatic reset or cleanup runs after a failure.

ROOT accepted **retaining these clearly identified local QA rows** on2026-09-21.
No deletion of rows/receipts/audit or schema rollback is implied. Existing private
Realtime invalidation broadcasts occur normally with commands; they are distinct
from provider messages and staff notifications. Empty mentions must leave
`platform.staff_notifications` unchanged.

## Actual reader and access checks

Read and validate actual RPC responses through ordinary authenticated clients:

- Before writes: legitimate empty/latest and invalid inputs, NULL channel denial;
  existing Student and anonymous denial; Sales denied channel; a real other local
  tenant (if unavailable, report the limit rather than create one or fake proof).
- After55 general posts: latest returns positions6–55; before its first actual
  sequence returns1–5; their union contains exactly55 original IDs, no duplicates.
- Use actual returned decimal sequence strings, never assumed fixture ordinals.
  after(position27) returns28–55; context(position28) returns3–52;
  context(position2) preserves its real earlier/later neighbours at the boundary.
- Original IDs, author membership, timestamps, parent links and versions agree
  with the canonical owned rows. Compare only controlled IDs in private evidence;
  no raw content or Auth data is emitted to Git/chat.
- latest quote of off-page root1 changes after edit; context quote of root3 is
  a safe tombstone after delete; a deleted anchor still opens in context.
- Sales anchor in general is not_found; inaccessible tenant/channel is forbidden.
  Malformed cursors/modes/combinations fail explicitly without returning history.
- Existing v1 root/thread/message reads still behave as before. New reads never
  create preferences/read marks/receipts/audits/change rows. The watermark matches
  the existing change log at a captured no-writer boundary and is not a message
  sequence or implicit read cursor.
- Repeating each new reader request is read-only: capture counts/hashes around
  the read phase, separately from the explicitly declared fixture mutations.

The >50 proof comes from real commands and Auth, not unit fixture arrays. It is
technical local QA evidence only, not a real-customer or production acceptance.
No UI cutover, screenshots, broad E2E or unrelated heavy suite belongs here.

## Expected residue and release receipt

Assuming no pre-existing global chat history and no other writers, compared with
the fresh post-B baseline, the only proposed business changes are:

| Table | Expected delta |
| --- | --- |
| platform.team_chat_messages |+56 rows; root1 atversion2; root3 tombstoned atversion2|
| platform_private.team_chat_changes |+58 rows|
| platform_private.team_chat_receipts |+58 rows|
| platform.audit_events |+58 rows for the owned request IDs|

Every prior row must remain unchanged; for these4 tables, compare the original
rows after excluding exactly the recorded owned IDs/request IDs. Other business
tables stay equal. Preferences and stored `read_sequence` remain unchanged;
derived unread counts follow the actual reader, which excludes the current
author's own posts. With the checked zero-read baseline, the Sales author stays
at0. Another authorized employee would derive54 general and1 sales unread after
the tombstone, but that observer check is explicitly unproved: the configured
second Sales account cannot sign in. The revised packet uses only the existing
Sales author and Student, positively binding each current actor/role to the real
login user ID. No new identity or role is introduced. Staff notification tables
remain unchanged.
Auth user/identity counts unchanged; normal sign-in/session changes
are disclosed separately. Schema delta is only the new index/function/ACL and
ledger223; preserve all old function definitions, owners, grants, policies and
triggers. If an expected trigger makes another delta, stop and reconcile it;
do not silently broaden this allow-list after seeing the result.

The final private receipt must include actual checks/results, source+SQL+packet
hashes, current baseline/release references, exact owned IDs/counts and any
remaining unproved case. Redact user-facing output. Release the writer explicitly;
subsequent sessions baseline the retained authorized QA state rather than treating
it as an accidental change. Failed or partial execution remains visibly failed
or partial, and cannot be labelled PASS because unit tests passed.

## Execution status before revised QA

Reviewed executable v2 (`af6789ae4c5f3db45205ba48b9aba5fcd9ac491926bb29a1ce5a10e1a62a55a4`)
applied223 exactly once under ROOT's exclusive local window. Apply receipt SHA256
`5d7630913bcf9899378c730a738103ff77bd4a6d2d72217512ee6be73b6004ea` confirms
001–223, unchanged281 business tables and Auth counts, preserved existing
functions/indexes/columns/ledger, and only the additive reader/index/ACL.

The first QA invocation stopped at ordinary `salesOther` sign-in; no command
input/result file was created and no message was posted. It is not positive
reader evidence. Existing216 QA records already report this account's invalid
credentials; no credential guessing, repeated login, reset or provisioning is
authorized. Current failure did not record an HTTP code, so the historical400
must not be presented as a newly observed response.

Postfailure release SHA256
`fd4f632fbd4e30d70371e748230af29f05c5ebfd84e5f366462db197db33622e` confirms
full281/schema/ledger/Auth-count equality to the successful apply state and zero
QA commands/messages. Ordinary Sales/Student sign-in changed Auth session state;
session equality is not claimed. Preserve the failed attempt and all original
packet artifacts. Revised QA must use a fresh artifact directory, exact reviewed
script/source hashes and a new coordinator GO. It must never reapply223.
