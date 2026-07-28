# P1D: current-root WhatsApp object scope

Block-ID: `EVO-P1D-ROOT-WHATSAPP-AUTH-2026-07-28`

Status: plan amendment; runtime implementation is blocked until this document,
the long-run plan and the append-only decision entry are independently reviewed
and merged.

## Purpose

The root CRM `/whatsapp` surface currently uses custom cookie authentication,
SQLite `wa_*` shadow tables and coarse route-role checks. Admin, Sales and
Curator can reach the route, but conversation queries and actions do not apply
case or responsible-owner scope.

P1D closes that current-app authorization gap before the unified Supabase and
communications work. It preserves the accepted frontend structure and existing
manual/provider guards. It does not claim that root `/whatsapp` is EVO Inbox or
the target communications backend.

## Current verified gap

- `listConversations`, `getConversation` and `waMessages` read without an
  actor/object predicate.
- `sendWaMessageAction` and `markConversationReadAction` accept any existing
  conversation ID after only a coarse staff-role check.
- `createConversationAction` lets non-Admin staff create an unlinked local row
  even though ownership cannot then be proven.
- `/api/ai/draft` can load any submitted conversation ID for a role that may
  enter `/whatsapp`.
- The detail page can expose phone, transcript, amoCRM identifiers, agent
  metadata and reply controls to unrelated staff.
- Lead detail finds a conversation through the same unscoped global list.
- Lead/dashboard queries derive global WhatsApp recency, message-count, unread
  and response metrics without the conversation policy.
- The shared TopBar exposes a manual-create shortcut to non-Admin actors.

## Scope resolution

P1D resolves a conversation without trusting caller-provided ownership:

1. **Directly linked student case.** If `wa_conversations.client_id` resolves,
   the student-case lifecycle and assignment are authoritative for this
   temporary root scope only when `lead_id IS NULL`, or when a non-null
   `lead_id` resolves and its `leads.client_id` is either null or points to the
   same case:
   - Admin has full access;
   - the responsible Sales user has full access while the case is `pending`;
   - the assigned Curator has full access while the case is `active` or
     `closed`;
   - the former responsible Sales user has summary-only access after handoff;
   - every other actor has no access.
2. **Proven lead only.** The lead's responsible Sales user has full access only
   when `wa_conversations.client_id IS NULL`, `lead_id` resolves and that lead's
   own `client_id IS NULL`.
3. **Indirect, broken, conflicting or ownerless.** Admin alone has access when
   a lead already points to a case but the conversation does not, when the
   conversation and lead point to different cases, when either required link is
   broken, or when the applicable owner is missing. P1D does not guess or
   repair the association.
4. **Both consistent links.** The directly linked student-case rule takes
   precedence so a stale lead ownership path cannot restore Sales
   transcript/send access after handoff.

The root links remain non-canonical shadow data. P4/P5 later replace this
temporary rule with canonical amoCRM resolution and the unified communications
model.

## Access matrix

| Actor and state | Queue and detail | Protected content | Actions |
| --- | --- | --- | --- |
| Admin | All rows, full detail | Full current-root conversation and provider metadata | Draft, manual send, mark read and manual create through existing guards |
| Responsible Sales, proven lead-only or directly linked pending case | Own full queue/detail | Full transcript and linked pre-contract context | Draft, manual send and mark read; no manual create |
| Same Sales, active/closed handed-off case | Safe summary row/view only | No transcript, phone, message preview, unread state, provider IDs, amoCRM IDs, agent draft/reason metadata or deep links | No draft, send, mark read or create |
| Assigned Curator, active/closed case | Assigned full queue/detail | Full transcript and assigned student link; no unrelated Sales deep link | Draft, manual send and mark read; no manual create |
| Unrelated Sales or Curator | None | None | None |
| Finance or Student | No `/whatsapp` access | None | None |
| Unlinked, indirect-case, conflicting-link, broken-link or ownerless row | Admin only | Admin only | Admin only |

## Safe Sales post-handoff projection

The summary projection may select only:

- student case ID;
- student display name;
- target country;
- target degree;
- case state;
- assigned Curator display name;
- handoff timestamp.

The query must not first load a full conversation and then remove fields in
application code. It must not select phone, message text/preview, unread state,
conversation/provider identifiers, amoCRM identifiers, WAHA identifiers,
agent summary, handoff reason, draft-review fields or message rows.

## Required implementation surfaces

The same fail-closed policy must protect:

- `/whatsapp` list and `/whatsapp/[id]` direct route;
- list, detail and message queries;
- the conversation lookup on `/sales/[id]`;
- WhatsApp-derived recency, message-count, unread, response-time and aggregate
  fields loaded by shared lead/cockpit queries across `/sales`, `/sales/[id]`,
  `/dashboard`, `/calls` and `/tasks`; non-full actors receive no protected
  conversation-derived metric, even when a caller does not render the field;
- `sendWaMessageAction`;
- `markConversationReadAction`;
- `createConversationAction`, which becomes Admin-only in P1D;
- `/api/ai/draft`, before message/lead reads or the AI provider boundary;
- list/detail/reply UI controls, TopBar create shortcuts and deep links.

Full-access actions must re-authenticate and resolve the object inside the
server boundary. A hidden control is not authorization. Denials use a generic
not-found/forbidden result that does not disclose whether another actor's
conversation exists.

## Acceptance

Tests use synthetic local records only and cover:

- Admin positive list/detail/draft-control/action surfaces;
- responsible Sales on a lead-only and pending-case conversation;
- different Sales denial;
- the same Sales transition to summary-only immediately after handoff;
- assigned Curator on active and closed cases;
- different Curator denial;
- Finance and Student route/API/action denial;
- unlinked, ownerless and broken-link Admin-only behavior;
- a valid direct case with a non-null unresolved `lead_id` remaining
  Admin-only;
- lead-only proof where both conversation and lead case links are absent;
- indirect lead-to-case and conflicting direct/lead case links failing closed
  for every non-Admin actor;
- direct URL and forged-ID access;
- Server Action replay denial with unchanged SQLite rows;
- `/api/ai/draft` denial before protected reads or provider invocation;
- absence of restricted fields and controls from the Sales summary projection;
- absence of conversation-derived unread/count/recency/response metrics for
  summary-only or denied actors across every shared-query caller;
- Admin-only manual-create controls in both the inbox and shared TopBar;
- preservation of allowed client-bound Curator access.

Required validation is the root security/unit/lint/typegen/typecheck/build,
scenarios, dependency gates and full Playwright/a11y suite, plus exact-head
GitHub CI and an independent launch-control review.

`real-provider-proof: not-required`. Authorized WhatsApp send success is not an
acceptance criterion for this authorization block and must not be simulated
into a live-provider claim.

## Explicit exclusions

P1D does not:

- change SQLite schema or migrate data;
- change WAHA session, QR, webhook owner or webhook routes;
- connect root CRM to the separate Inbox Supabase project;
- unify conversation history or identifiers;
- add raw-event persistence, ACK/outbox/retry/dead-letter/reconciliation;
- absorb or delete Lead Agent;
- redesign AI language/knowledge behavior;
- enable auto-reply, broadcast, flow or unattended outbound;
- deploy or mutate any production/provider state.

These remain P2-P5/P8 work under their existing real-evidence gates.

## Rollback

P1D implementation is a code-only authorization/query/UI change. Rollback is a
reviewed code revert; no database restore is required. Because rollback would
reopen data exposure, it is not a routine production response and still
requires incident authorization. This plan amendment itself is docs-only.
