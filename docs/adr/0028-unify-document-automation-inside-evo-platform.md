# ADR 0028: Unify document automation inside EVO Platform

- Status: accepted target; implementation and retirement pending
- Date: 2026-09-13
- Supersedes: ADR0017's separate-product ownership decision
- Preserves: ADR0024/0027 canonical managed Supabase and one V3 product

## Decision

The owner explicitly requests moving useful EVO Docs functions into EVO Platform
and removing the separate app. EVO Platform now owns document extraction,
human-confirmed field proposals and profile/form/package exports, alongside its
existing Admissions and Student document lifecycle.

Use the existing staff identity, versioned permissions, case/document identity,
private Storage, audit and UI. Do not embed the separate app as an iframe, maintain
a second login, synchronize a second business database or run its SQLite authority
inside the Platform. Port useful bounded code/assets, not an entire legacy stack.

AI outputs remain proposals with source/version provenance. Processing must be
an explicit authorized action on a clean permitted document, not automatic bulk
disclosure. Human acceptance is required before canonical profile fields change.
No private Student assessments enter this pipeline. Provider retention, cleanup,
failures and persistent job recovery must be explicit and independently verified.

## Migration and retirement

Follow [the implementation and retirement plan](../design/v3/evo-docs-unification-run-plan.md).
Local and server inventories differ; inspect metadata/counts first, preserve
originals, review/export history and hashes, and reconcile any approved transfer.
Do not interpret retiring the app as permission to erase local records, GitHub
history, shared proxy networks, shared secrets or canonical Platform data.

After real integrated acceptance, retire the exact standalone service/route and
owned obsolete runtime configuration, keeping an inventory and recoverable source
history. No new backup system is implied; the owner's earlier backup decision is
unchanged. Removal of nonempty original data needs an explicit approved inventory.

This supersedes standalone expansion plans, not immutable prior evidence. The
separate application's current operation is not proof of integrated readiness.
