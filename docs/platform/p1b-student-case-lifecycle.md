# P1B: student case lifecycle and Curator handoff

- Block: `EVO-P1B-CASE-LIFECYCLE-2026-07-28`
- Scope: local SQLite transition model before the P2/P3 Supabase migration
- Provider boundary: no amoCRM, Supabase, WAHA, AI, or production mutation
- Production state: not deployed by this block

## What this block establishes

`clients.stage` remains the operational admissions stage. A separate
`clients.case_state` records the lifecycle of the student case:

```text
pending --Admin assignment after confirmed contract--> active
active  --Admin or assigned Curator, with reason-----> closed
closed  --Admin or assigned Curator, with reason-----> active
```

The contract fields are read-only in P1. P1B does not infer a signed contract
from an admissions stage or from a manually moved sales card. The future P4
amoCRM adapter must populate `contract_confirmed_at` and the opaque
`contract_confirmation_ref` only after it has matched the account's versioned
pipeline/status mapping.

An Admin assignment or reassignment:

1. authenticates and authorizes the Server Action itself;
2. accepts only a user whose database role is `curator`;
3. requires a non-empty reason of at most 1,000 characters;
4. requires the existing contract confirmation fields;
5. updates assignment, handoff, portal activation, and lifecycle state in one
   immediate SQLite transaction;
6. appends a before/after audit row in the same transaction.

Close and reopen follow the same transaction and audit boundary. Only an Admin
or the currently assigned Curator may perform them. General profile updates
cannot change `manager_id`, `curator_id`, `case_state`, or the legacy
`archived` stage.

Next.js documents that every Server Action must repeat authentication and
authorization and should be treated as a public HTTP endpoint. UI visibility
is therefore not the security boundary:
[Next.js data security](https://nextjs.org/docs/app/guides/data-security#built-in-server-actions-security).

## Additive migration behavior

- Existing databases receive nullable lifecycle metadata columns and
  `case_state TEXT NOT NULL DEFAULT 'pending'`.
- Existing client rows are not silently activated, assigned, or treated as
  contract-confirmed.
- Fresh non-production demo data marks one synthetic fixture explicitly active
  with a `synthetic:` confirmation reference. It is test/demo evidence only.
- Database triggers reject unsupported states and transitions, non-Curator
  assignments, incomplete active/closed cases, and changes to audit rows.
- P1B does not copy, delete, or rewrite production customer data.

SQLite documents that an `IMMEDIATE` transaction begins the write transaction
up front. That is the transaction mode used for the lifecycle change and audit
append:
[SQLite transactions](https://www.sqlite.org/lang_transaction.html).

## Deployment gate for a later authorized release

Do not apply this change to production as part of the P1B merge. A separately
authorized release must first:

1. record the exact application and database versions;
2. stop or fence application writes for the backup window;
3. create and verify a consistent database backup, including an integrity
   check and restore rehearsal;
4. inventory existing clients and prove that every existing row remains
   `pending` with null lifecycle metadata after a dry run;
5. deploy the matching application and schema together;
6. verify that manual sales-stage movement still cannot activate a case;
7. activate real cases only after the P4 account-specific amoCRM mapping is
   approved and proven with a sanitized test lead.

SQLite's online backup API produces a consistent snapshot of a live source
database, but application-level write fencing and restore verification remain
release requirements:
[SQLite Online Backup API](https://www.sqlite.org/backup.html).

## Rollback

The safe rollback unit is the matching application plus database backup. Do not
drop the additive columns, triggers, or audit table in place: that would destroy
evidence and is outside the expand/contract policy. If the release fails,
restore the verified pre-release database in isolation, deploy the previous
application revision, validate counts and integrity, then switch traffic back.

## Evidence boundary

Automated tests prove local authorization, transition, atomicity, portal
gating, and append-only behavior with synthetic fixtures. They do not prove:

- the correct amoCRM contract status mapping;
- a real provider event;
- a production migration or rollback;
- Supabase Auth/RLS;
- the complete WhatsApp-to-audit path.

Those proofs remain gates for P2–P8. Lead Agent retirement remains prohibited
until the separate P9 cutover and at least 72 actual hours of stable traffic.
