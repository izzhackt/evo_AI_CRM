# EVO Admissions Platform frontend

This folder is the repository-local index for the unified staff workspace and
Student Portal frontend.

## Start here

| File | Purpose |
|---|---|
| [`EVO_PLATFORM_LONG_RUN_PLAN.md`](../../EVO_PLATFORM_LONG_RUN_PLAN.md) | Current execution contract for the unified backend, migration, provider proof and release gates |
| [`ADR 0020`](../../adr/0020-unify-evo-v1-on-canonical-supabase.md) | Current ownership, migration and one-product decision under parent #376 |
| [`CLAUDE_DESIGN_MASTER_PROMPT.md`](CLAUDE_DESIGN_MASTER_PROMPT.md) | One autonomous prompt for a full frontend pass in the linked local repository |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Implemented frontend contract plus its alignment boundary with the unified-platform target |
| [`COMPLETION_CHECKLIST.md`](COMPLETION_CHECKLIST.md) | Evidence ledger used before reporting frontend completion |
| [`SOURCE_BRIEF_IT_TZ.md`](SOURCE_BRIEF_IT_TZ.md) | Interpreted first-iteration context from the IT-authored brief |
| [`FINAL_FRONTEND_AUDIT_2026-07-24.md`](FINAL_FRONTEND_AUDIT_2026-07-24.md) | Final implementation verdict, validation results, boundaries and current browser evidence |
| [`AUDIT_2026-07-24.md`](AUDIT_2026-07-24.md) | Audit of the original Claude Design archive before implementation |

## Source hierarchy

When sources disagree, use this order:

1. owner instructions and `AGENTS.md`;
2. parent issue #376, ADR 0020 and
   `docs/EVO_PLATFORM_LONG_RUN_PLAN.md` for target-state work;
3. accepted ADRs, `CONTEXT.md` and platform data-ownership docs;
4. current application code, server-side permissions and tests as evidence of
   what exists now, not as authority to preserve target-state gaps;
5. the EVO logobook and verified company/business documents;
6. this frontend implementation plan and completion checklist;
7. the IT-authored brief as non-final business context;
8. historical prototype HTML and screenshots as visual/interaction reference.

Neither a prototype interaction nor a screenshot proves that an external
provider, database bridge or backend mutation is live.

## Real application

The frontend is implemented in the root Next.js application:

- staff: `/login`, `/dashboard`, `/sales`, `/clients`, `/applications`,
  `/documents`, `/visa`, `/finance`, `/tasks`, `/calls`, `/whatsapp`, `/chat`,
  `/notifications`, `/reports`, `/settings`;
- student: `/portal` and the documents, applications, visa, payments,
  messages, notifications, team and profile sections below it.

The implemented frontend currently preserves the root application's existing
authentication and permissions. That is a current-runtime statement, not proof
that the target backend migration is complete.

The first-pilot role set is Sales Manager (`sales`), Admissions Manager backed
by the existing canonical admissions role, and Director/Admin (`admin`). There
is no separate `visa` or `finance` pilot role; those are permissioned modules.
Admin alone manages staff and exceptional reassignment with mandatory reason
and audit. Sales owns the queue before confirmed contract plus first mandatory
payment; assigned Admissions owns the case after handoff. History remains
unified, with only an authorized non-sensitive summary visible to Sales.

EVO/Supabase is canonical for operational client, lead, owner and stage data.
amoCRM is a temporary read/import adapter, and WAHA is private transport. AI
suggestions are human-reviewed and grounded only in approved, versioned
knowledge. Stage one has no outbound WhatsApp send action and no amoCRM write.
EVO must not guarantee admission, scholarship, visa or another external
decision.

## Visual references and evidence

- `prototype/` contains the immutable original Claude Design HTML handoff.
- `audit-screenshots/` records the original handoff audit.
- `completed-concepts/` records the approved responsive visual direction.
- `implementation-screenshots/` records browser evidence from implementation
  slices.
- `implementation-screenshots/final-audit/` contains the final current captures
  and side-by-side reference/current comparisons.

Evidence folders are useful for visual comparison. They are not a substitute
for running the current application and tests.

## Explicitly outside the completed frontend slice

- the unified Supabase migration and auth/RLS cutover;
- retiring EVO Lead Agent or a legacy WhatsApp session;
- changing amoCRM, WAHA, AI, email or telephony configuration;
- changing provider credentials, DNS or production infrastructure;
- proving a real outbound WhatsApp message or another live provider workflow;
- production deployment.

Those items now belong to the long-run plan. Their presence in that plan does
not make them part of the already completed frontend slice, and no target
provider is considered live without the required real integration evidence.
