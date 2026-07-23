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

## Superseded Documents Retained At Stable Paths

| Document                                                                      | Why it is retained                                 | Current replacement                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| [`EVO_INBOX_IMPLEMENTATION_ISSUES.md`](../EVO_INBOX_IMPLEMENTATION_ISSUES.md) | Original dependency split and draft issue bodies   | GitHub Issues and the launch plan                         |
| [`EVO_INBOX_REMOTE_LONG_RUNS.md`](../EVO_INBOX_REMOTE_LONG_RUNS.md)           | Earlier server workspace and Codex prompt sequence | `CONTRIBUTING.md`, `AGENTS.md`, and current GitHub Issues |
| [`LONG_RUN_CODEX_LAUNCH_HANDOFF.md`](../LONG_RUN_CODEX_LAUNCH_HANDOFF.md)     | Snapshot of an earlier launch-control handoff      | The launch plan and append-only decision log              |

The documents remain at their original paths so older commits and decision
records keep working links. Each has a warning banner at the top.

## Archive Rule

When a document becomes historical:

1. add a clear warning that names the current replacement;
2. list it in this index;
3. keep it out of active checklists and onboarding paths; and
4. preserve its original content except for factual corrections or the archive
   banner.

Do not archive code, migrations, secrets, customer data, database files, or
runtime evidence here.
