# EVO Admissions Platform frontend

This folder is the repository-local index for the unified staff workspace and
Student Portal frontend.

## Start here

| File | Purpose |
|---|---|
| [`CLAUDE_DESIGN_MASTER_PROMPT.md`](CLAUDE_DESIGN_MASTER_PROMPT.md) | One autonomous prompt for a full frontend pass in the linked local repository |
| [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Approved route, role, source-of-truth and validation contract |
| [`COMPLETION_CHECKLIST.md`](COMPLETION_CHECKLIST.md) | Evidence ledger used before reporting frontend completion |
| [`SOURCE_BRIEF_IT_TZ.md`](SOURCE_BRIEF_IT_TZ.md) | Interpreted first-iteration context from the IT-authored brief |
| [`FINAL_FRONTEND_AUDIT_2026-07-24.md`](FINAL_FRONTEND_AUDIT_2026-07-24.md) | Final implementation verdict, validation results, boundaries and current browser evidence |
| [`AUDIT_2026-07-24.md`](AUDIT_2026-07-24.md) | Audit of the original Claude Design archive before implementation |

## Source hierarchy

When sources disagree, use this order:

1. owner instructions and `AGENTS.md`;
2. current application code, server-side permissions and tests;
3. `CONTEXT.md`, platform data-ownership docs and accepted ADRs;
4. the EVO logobook and verified company/business documents;
5. the implementation plan and completion checklist;
6. the IT-authored brief as non-final business context;
7. historical prototype HTML and screenshots as visual/interaction reference.

Neither a prototype interaction nor a screenshot proves that an external
provider, database bridge or backend mutation is live.

## Real application

The frontend is implemented in the root Next.js application:

- staff: `/login`, `/dashboard`, `/sales`, `/clients`, `/applications`,
  `/documents`, `/visa`, `/finance`, `/tasks`, `/calls`, `/whatsapp`, `/chat`,
  `/notifications`, `/reports`, `/settings`;
- student: `/portal` and the documents, applications, visa, payments,
  messages, notifications, team and profile sections below it.

The root application preserves existing authentication and permissions.
amoCRM remains canonical for lead/contact identity and sales status. AI
customer communication remains draft-only with a human-controlled send.

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

## Explicitly outside the frontend slice

- merging or moving Supabase databases;
- deleting or retiring EVO Lead Agent;
- changing amoCRM, WAHA, AI, email or telephony configuration;
- changing provider credentials, DNS or production infrastructure;
- proving a real outbound WhatsApp message or another live provider workflow;
- production deployment.

Those items require separate architecture, authorization and real integration
evidence.
