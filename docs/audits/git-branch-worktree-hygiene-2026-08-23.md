# Git branch and worktree hygiene audit — 2026-08-23

## Decision

GitHub `main` remains the only shared code source of truth. Feature branches
and linked worktrees are temporary delivery tools, not alternative product
versions or deployment authorities. Cleaning them does not change the accepted
all-in-one EVO architecture, the Supabase authority, or production.

This document is an audit and an itemized cleanup proposal. It does not itself
authorize deletion. Remote branches, local branches, and worktrees may be
removed only after the owner approves the exact batch below. The original
checkout and every dirty worktree remain untouched.

## Evidence snapshot

Read-only inventory was taken on 2026-08-23 against GitHub `main`
`2db8810213c7944aaf2f1b8e52ef4c0ab7824aa5`:

- GitHub branches: `96`;
- open pull requests: `16`, all drafts;
- remote heads that exactly equal a merged PR head: `69`;
- remote heads that exactly equal a closed, unmerged PR head: `8`;
- remote branch changed after its PR closed: `1`;
- remote branch with no PR: `1`;
- local branches before this audit worktree was added: `273`;
- worktrees before this audit worktree was added: `150`;
- dirty worktrees: `9`;
- clean detached worktrees: `39`.

The repository already has GitHub's automatic merged-head deletion enabled.
It does not delete local branches or local worktrees, and it did not
retroactively remove older remote heads. The repository uses squash merges, so
commit ancestry alone is not a safe classification method: a merged branch tip
is commonly not an ancestor of the squash commit in `main`. Classification
therefore uses GitHub PR state and exact head SHA, open-PR base dependencies,
patch comparison, worktree cleanliness, and commit recoverability.

Official behavior references:

- [Git branch reachability filters](https://git-scm.com/docs/git-branch/2.50.0.html)
- [Git worktree removal and pruning](https://git-scm.com/docs/git-worktree)
- [GitHub branch deletion and restoration](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/deleting-and-restoring-branches-in-a-pull-request?apiVersion=2022-11-28)
- [GitHub automatic deletion of merged branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches)

## Why the repository accumulated branches

The volume is mainly historical delivery residue, not 96 competing product
versions:

1. Each launch-control, review, preflight, or rollout lane often received its
   own branch and physical worktree.
2. GitHub removed some merged remote heads, but the corresponding local branch
   and worktree remained.
3. Older merged heads predate or escaped the automatic-delete setting.
4. Squash merging makes ordinary `git branch --merged` undercount completed
   work.
5. Sixteen draft PRs were paused while the Platform architecture and release
   boundary continued to change.

## Open PR disposition

No existing draft branch is approved for direct merge. Every retained feature
must first be rebuilt or refreshed from current `main`, retested, independently
reviewed, and pass exact-head CI. This avoids reviving an obsolete runtime or
old migration numbering.

| PR | Branch or stack | Disposition | Reason |
|---:|---|---|---|
| 356, 361 | `admissions-country-overview` -> `admissions-filters` | Keep as source; rebuild in dependency order | Valuable unified Admissions/CEO workflow; the second PR is stacked on the first. |
| 359, 360 | `stop-factors` -> `case-block-visibility` | Keep as source; rebuild in dependency order | Valuable Finance-to-case workflow; the visibility PR depends on the stop-factor model. |
| 346 | `staff-management-screen` | Keep and refresh | Fits the single UI and role model, but must be reconciled with current Supabase provisioning. |
| 357 | `audit-summary` | Salvage on current `main` | Useful audit questions, but GitHub reports the old draft as conflicting. |
| 347 | `deploy-verification` | Salvage and revalidate | Read-only verification is useful, but the production/release layout changed after the draft. |
| 334 | `ci-root-python-tests` | Reimplement and prove | Small CI improvement; the old run had a failed check and current root tests must be verified. |
| 317, 322, 337 | catalog source, schema plan, programme migrations | Reaffirm current catalog and owner decisions, then rebuild | The all-in-one/Supabase authority is settled, but the draft migrations use numbers now occupied by `078-082`, later catalog work corrected parts of the design, and catalog semantics plus intake/pricing still need owner confirmation. |
| 320 | `kpi-definitions` | Owner business decision | KPI definitions are a business contract, not a technical cleanup decision. |
| 319 | `repo-hygiene` | Preserve, do not merge now | It overlaps an untracked ADR and modified `.gitignore` in the original dirty checkout. |
| 316 | `tz-traceability-refresh` | Regenerate from current `main` | The status matrix is time-sensitive and predates the all-in-one/current-main corrections. |
| 343 | `hermes-environment-facts` | Refresh read-only, then replace | Server facts are volatile and the draft predates the latest release-path work. |
| 159 | `waha-knowledge-export` | Do not merge; decide whether to redesign | It assumes an older WAHA/archive contour and needs explicit privacy and current `evo-inbox` review. |

Five non-open branches also remain on hold:

- `izzhackt/evo-platform-p4b-mapping-approval` has no PR and contains a stale,
  large deferred amoCRM checkpoint; only selective current-main salvage is
  allowed.
- `izzhackt/student-document-workbench-bw8b` changed after closed PR #121 and
  is far behind current `main`; preserve until its useful document workflow is
  assessed outside this cleanup.
- `izzhackt/evo-inbox-folder-rename` is the branch checked out in the original
  repository root. PR #40 is merged, but that checkout contains current
  uncommitted user work, so neither its worktree nor its local/remote branch is
  part of the first cleanup wave.
- `izzhackt/passport-sheet-automation` was closed in PR #98 only to pause for
  launch ordering, with an explicit instruction to preserve and potentially
  rebase/reopen it. It needs a new owner disposition before deletion.
- `izzhackt/bw8b-runtime-plan-amendment` was likewise explicitly preserved when
  PR #123 closed for sequential launch control. Later boundaries may make it
  stale, but cleanup does not silently replace that recorded hold decision.

Closed PR #369 and branch `izzhackt/fix-platform-connected-reliability` are not
a salvage lane. Its first seven commits were the head of merged PR #367; its
last DNS/edge commit was explicitly closed as superseded by PR #370, and the
owner later deferred canonical DNS/TLS. The PR record remains the recovery
point after branch deletion.

## Proposed exact cleanup batches

### R1 — merged remote heads, excluding the dirty root branch

Delete these `68` GitHub branches only after owner approval. Every name is the
exact head of a merged PR, none is an open PR head or an open PR base, and the
merged PR remains the recovery record:

```text
izzhackt/evo-inbox-light-default
izzhackt/evo-platform-auth-local-readiness-plan
izzhackt/evo-platform-business-workflow-plan
izzhackt/evo-platform-bw1-workflow-contracts
izzhackt/evo-platform-bw2-repositories
izzhackt/evo-platform-bw3-student-profile
izzhackt/evo-platform-bw4-decision-lifecycle
izzhackt/evo-platform-bw5-catalog-boundary-v2
izzhackt/evo-platform-bw5-plan-checkpoint
izzhackt/evo-platform-bw6-contract-report
izzhackt/evo-platform-bw7-integration-proof-v2
izzhackt/evo-platform-bw8-boundary-amendment
izzhackt/evo-platform-ci-advisory-fix
izzhackt/evo-platform-direct-merge-governance
izzhackt/evo-platform-greenfield-ui-plan
izzhackt/evo-platform-local-reliability
izzhackt/evo-platform-local-reliability-plan
izzhackt/evo-platform-mvp-autonomy-plan
izzhackt/evo-platform-mvp-contract-sync
izzhackt/evo-platform-nanoid-audit-fix
izzhackt/evo-platform-p0-plan
izzhackt/evo-platform-p1a-role-removal
izzhackt/evo-platform-p1b-case-lifecycle
izzhackt/evo-platform-p1c-object-scope
izzhackt/evo-platform-p1d-auth
izzhackt/evo-platform-p1d-plan
izzhackt/evo-platform-p2-freshness
izzhackt/evo-platform-p2-plan
izzhackt/evo-platform-p2a-supabase-authority
izzhackt/evo-platform-p2b-grants
izzhackt/evo-platform-p2g-ci-registry-fallback
izzhackt/evo-platform-p2g-queues
izzhackt/evo-platform-p2h-private-storage
izzhackt/evo-platform-p2r3-auth-repair
izzhackt/evo-platform-p2r3-stale-session-plan
izzhackt/evo-platform-p2r4-local-migration-plan
izzhackt/evo-platform-p2r4-validation-plan
izzhackt/evo-platform-p2r4-validation-repair
izzhackt/evo-platform-p3a-supabase-auth
izzhackt/evo-platform-p3b-conversations
izzhackt/evo-platform-p3c-manual-send
izzhackt/evo-platform-p4a-amocrm-mapping
izzhackt/evo-platform-p4b-amocrm-mapping-plan
izzhackt/evo-platform-p5-scope-amendment
izzhackt/evo-platform-p5a-waha-ingress
izzhackt/evo-platform-p5b-waha-projection
izzhackt/evo-platform-p5c-waha-history
izzhackt/evo-platform-p5d-media-ack-realtime
izzhackt/evo-platform-p5f1-ai-memory
izzhackt/evo-platform-p5f-plan-amendment
izzhackt/evo-platform-p6-plan-amendment
izzhackt/evo-platform-p6a-portal-attention
izzhackt/evo-source-of-truth
izzhackt/evo-source-of-truth-closeout
izzhackt/evo-source-of-truth-durable-status
izzhackt/p2r5-durable-claim-plan
izzhackt/revert-pr120-shared-scope
izzhackt/revert-pr122-shared-scope
izzhackt/revert-pr124-shared-scope
izzhackt/student-document-workbench-bw8a
izzhackt/student-document-workbench-plan
izzhacktcodex/amocrm-prod-seed-proof
izzhacktcodex/evo-inbox-inbound-waha
izzhacktcodex/evo-inbox-manual-waha-reply
izzhacktcodex/evo-inbox-supabase-store
izzhacktcodex/evo-inbox-waha-amocrm
izzhacktcodex/evo-inbox-waha-companion
izzhacktcodex/gemini-embeddings-scale
```

### R2 — closed remote heads with clear merged replacements

Delete these `6` GitHub branches only after owner approval. They exactly match
closed PR heads, have a clear merged successor/current decision, and the closed
PR remains restorable:

```text
izzhackt/evo-platform-auth-local-readiness
izzhackt/evo-platform-auth-local-readiness-repair
izzhackt/evo-platform-bw5-catalog-boundary
izzhackt/evo-platform-bw7-integration-proof
izzhackt/evo-platform-p5e-ack-realtime-plan
izzhackt/fix-platform-connected-reliability
```

### L1 — merged, unbound local branches

Delete these `18` local branches with safe `git branch -d` only after owner
approval. None is checked out in a worktree or is an open PR head; `-D` is not
authorized:

```text
izzhackt/evo-inbox-migration-037-uuid
izzhackt/evo-inbox-outbound-audit
izzhackt/evo-platform-audit-20260823
izzhackt/evo-platform-orbstack-storage-fix
izzhackt/evo-platform-p2r4-local-migration-harness
izzhackt/evo-platform-p4-split-plan
izzhackt/evo-platform-p4b-amocrm-mapping-approval
izzhacktcodex/admissions-crm-core
izzhacktcodex/amocrm-integration
izzhacktcodex/evo-launch-plan-contract
izzhacktcodex/production-hardening
izzhacktcodex/promise-audit-telephony
izzhacktcodex/public-promise-live-audit
izzhacktcodex/qa-launch
izzhacktcodex/student-portal
izzhacktcodex/student-portal-contract-repair
izzhacktcodex/student-portal-takeover
izzhacktcodex/waha-integration
```

### W1 — detached worktrees

Delete these `38` clean detached worktrees only after owner approval. Each HEAD
was proved recoverable through `origin/main`, another persistent Git ref, or an
associated GitHub PR. Removal must use `git worktree remove` without `--force`:

```text
/Users/iskhak.tazhibaev/.codex/worktrees/1a2a/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/1be2/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/3336/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/3f35/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/53fd/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/5dab/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/65c8/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/69f2/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/9598/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/bfbb/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/d3ac/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/e0f5/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/e6ed/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p7a-audit-search-export
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4-candidate-d565
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4f-source-aaa9
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4j-control
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4m-production
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4n-production
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4o-production-final
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4p-production-final
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4q-execution
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4r-execution
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4s-execution
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8d4t-execution
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8v2-application-0f1454
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p8v2-release-control-2a34408d
/Users/iskhak.tazhibaev/.codex/worktrees/evo-platform-p8u2-source
/Users/iskhak.tazhibaev/.codex/worktrees/evo-platform-p8u2-tooling
/Users/iskhak.tazhibaev/.codex/worktrees/f1de/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/p8b2-manifest/evo_AI_CRM
/private/tmp/evo-p8v2f-exec.9mHAhB/repo
/private/tmp/evo-p8v2f-final-preflight.6AGwGA/repo
/private/tmp/evo-p8v2g-preflight.P43U3U/repo
/private/tmp/evo-p8v2h-preflight.30hIh8/repo
/private/tmp/evo-p8v3k-clean
/private/tmp/evo-p8v3k-final-main-5b8b4452
/private/tmp/evo-p8v3k-main.kLyxu7
```

The remaining clean detached worktree is not deletable yet:

```text
/private/tmp/evo-p8v3k-head
HEAD 124cf333469cb734387309cd49ec176b181e0c25
```

That commit is not reachable from `origin/main`, has no containing local or
remote ref/tag, and has no GitHub PR association. It is the only
`W-archive-first` item and remains preserved until its patch is inspected and
the owner approves either an archive ref or discard. Global pruning and Git
garbage collection remain unauthorized.

### D1 — dirty worktrees: preserve

These `9` worktrees are excluded from cleanup until their changes receive an
individual keep/commit/discard decision:

```text
/Users/iskhak.tazhibaev/Documents/01_Projects/evo_AI_CRM
/Users/iskhak.tazhibaev/Documents/01_Projects/evo_AI_CRM-pr40-review
/Users/iskhak.tazhibaev/.codex/worktrees/e9a7/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p2r4-local-migration-repair
/private/tmp/claude-502/-Users-iskhak-tazhibaev-Documents-01-Projects-evo-AI-CRM/96d61acb-a49a-41e9-923a-3098b73b0cdb/scratchpad/evo-docs
/private/tmp/evo-next-wave-control
/private/tmp/evo-p8v3-dnsfix.HrpKFA
/private/tmp/evo-release-tooling-parallel
/private/tmp/evo-staging-status.aVNHpE
```

## Audit validation

The proposed batches were independently re-evaluated from the document rather
than trusted as manually copied lists:

- all `68` R1 names exist at the fetched remote SHA, exactly match a merged PR
  head, and are neither an open PR head nor an open PR base;
- all `6` R2 names exist at the fetched remote SHA, exactly match a closed PR
  head, and are neither an open PR head nor an open PR base;
- all `18` L1 names exist locally, are ancestors of current `origin/main`, have
  no worktree binding and are not an open PR head;
- all `38` W1 paths exist, are clean and detached, and have a persistent
  recovery path;
- all `9` D1 paths exist and remain dirty;
- the excluded `evo-p8v3k-head` detached SHA remains without a persistent ref
  or GitHub PR association and therefore stays protected.

These are audit-time facts, not permission to delete. The same checks must pass
again immediately before an approved execution.

## Execution and verification contract

For an approved batch:

1. Re-fetch GitHub state and stop if a named branch became an open PR head or
   base, changed SHA, or `main` changed in a way that invalidates the audit.
2. Record branch name, old SHA, PR number/state, and local worktree binding in
   the execution evidence before deletion.
3. Delete only exact approved names. Do not use globs, `git branch -D`,
   `git worktree remove --force`, filesystem recursion, global prune, or Git
   garbage collection.
4. Re-query GitHub, local refs, worktrees, and all nine dirty statuses. The
   dirty-status text must remain unchanged.
5. Remove the temporary hygiene worktree after its plan PR is merged and its
   branch is no longer needed.

No cleanup batch deploys code, changes DNS/TLS, calls a live provider, sends a
WhatsApp message, writes amoCRM, changes a WAHA session, or runs the dedicated
security scan.

## Steady-state policy

- `main` is protected and is the only shared integration/source-of-truth
  branch.
- A feature branch should correspond to one current PR or one explicitly
  recorded salvage checkpoint.
- After a PR merges, GitHub automatic deletion handles the remote head and the
  owner of its local worktree removes the clean worktree and local branch.
- Stacked PRs must name their dependency; the base branch is retained until
  its dependent PR is rebased.
- Monthly hygiene is read-only first: refresh refs, list PR dependencies,
  inspect dirty worktrees, and report exact candidates before deleting.
