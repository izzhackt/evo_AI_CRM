# Historical Documentation Index

This index identifies documents retained for audit and planning provenance. They
are not current instructions, task trackers, or deployment runbooks.

## Current Sources

- Active implementation contract: [`../EVO_LAUNCH_PLAN.md`](../EVO_LAUNCH_PLAN.md)
- Append-only decision history: [`../PLAN_CHANGES.md`](../PLAN_CHANGES.md)
- Active work and status:
  [GitHub Issues](https://github.com/izzhackt/evo_AI_CRM/issues)
- Repository workflow: [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)
- Production boundaries: [`../../AGENTS.md`](../../AGENTS.md)

## Superseded Documents

| Document                                                                      | Why it is retained                                 | Current replacement                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| [`inbox-implementation-issues.md`](plans/inbox-implementation-issues.md) | Original dependency split and draft issue bodies   | GitHub Issues and the launch plan                         |
| [`inbox-remote-long-runs.md`](plans/inbox-remote-long-runs.md)           | Earlier server workspace and Codex prompt sequence | `CONTRIBUTING.md`, `AGENTS.md`, and current GitHub Issues |
| [`long-run-codex-launch-handoff.md`](plans/long-run-codex-launch-handoff.md)     | Snapshot of an earlier launch-control handoff      | The launch plan and append-only decision log              |

These three documents moved to [`plans/`](plans/) on 2026-11-02 (old paths are
listed in the 2026-11-02 entry of `../PLAN_CHANGES.md`). Each has a warning
banner at the top.

## Closed plans, reports and handoffs

- [`plans/`](plans/) — dated plans, execution ledgers, handovers, QA reports and
  PRDs that are finished. Names are `YYYY-MM-DD-topic.md`. Not current
  instructions.
- [`lead-agent/`](lead-agent/) — evaluation notes of the retired WhatsApp
  lead-agent (its code is kept under git tag
  `archive/lead-agent-and-inbox-2026-11-02`).

## Frozen V1 deployment material

The former multi-runtime deployment, runtime-hardening, recovery, and Lead
Agent environment documents are retained under [`v1/`](v1/README.md). They are
historical rollback/decision inputs only. Never execute, source, import, or
bundle them as successor release inputs.

## Archive Rule

When a document becomes historical:

1. add a clear warning that names the current replacement;
2. list it in this index;
3. keep it out of active checklists and onboarding paths; and
4. preserve its original content except for factual corrections or the archive
   banner.

Do not archive code, migrations, secrets, customer data, database files, or
runtime evidence here.
