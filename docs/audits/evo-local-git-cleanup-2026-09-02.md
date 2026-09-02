# EVO local Git cleanup - 2026-09-02

Status: completed to the safe non-destructive boundary  
Shared baseline: `origin/main`
`cf108403c69a35ca3b134652de8f2aa26eb5a049`  
Scope: stale GitHub pull requests, local branches and registered worktrees only

## Result

- GitHub has zero open pull requests after merged PR #564. There is no stale PR
  left to merge or close.
- Registered worktrees decreased from 111 to 109. Only these two clean,
  fully-merged disposable worktrees were removed:
  - `.claude/worktrees/great-albattani-77fb29`
  - `.claude/worktrees/product-interface-structure-2f97cc`
- Their attached local branches were deleted with normal merged-branch
  deletion. No dirty or unique worktree was removed.
- The completed P4 local branch
  `izzhackt/p4-supabase-admissions-storage` was deleted only after its full tree
  compared equal to the merged PR #564 tree on `origin/main`; its remote branch
  had already been removed by GitHub.
- Stale local `main` was advanced from ancestor `16cf107c` to exact
  `origin/main` `cf108403`; the ancestry check passed before the ref moved.
- Fifteen additional unattached local branches were deleted only after all
  three checks passed: their heads were ancestors of `origin/main`, none was
  attached to a worktree, and none had an open pull request.

## Deleted fully-merged unattached branches

- `claude/evo-v2-frontend-audit-d70420`
- `fix/p8v3-importer-network`
- `izzhackt/evo-next-wave-control`
- `izzhackt/evo-release-tooling-parallel`
- `izzhackt/evo-u3-receive-only-sales-queue-380`
- `izzhackt/evo-unified-program-20260824`
- `izzhackt/evo-v1-v2-plan-20260827`
- `izzhackt/evo-v2-architecture-reset`
- `izzhackt/knowledge-sync-validation-speed`
- `izzhackt/p8v2-staging-status`
- `izzhackt/v2-7-student-360`
- `izzhackt/v2-9a-whatsapp-canonical`
- `izzhackt/v2-amocrm-canonical-write-foundation`
- `izzhackt/v2-waha-outbound`
- `izzhackt/v2-waha-recovery-evidence-finalize`

## Preserved boundary

The post-cleanup inventory has 109 registered worktrees. Excluding the active
P5 planning worktree, nine contain uncommitted work and 99 clean worktrees have
heads that are not ancestors of current `origin/main`. No clean fully-merged
worktree remains as a safe deletion candidate.

There are 351 local branches: 108 attached to worktrees and 243 unattached.
Among the unattached set, only canonical `main` is already merged; it is kept
and aligned to `origin/main`. The other 242 unattached branches are divergent
or contain commits not reachable from current shared main. They remain intact.

Further deletion therefore requires a new branch-by-branch or worktree-by-
worktree content review. A name, age or closed historical issue is not enough
evidence to delete unique work.

## Checks used

- `gh pr list --state open` for the current GitHub PR surface;
- `git worktree list --porcelain` for attachment inventory;
- `git status --porcelain` inside every registered worktree;
- `git merge-base --is-ancestor <head> origin/main` for reachability;
- `git diff --quiet origin/main <branch>` for the squash-merged P4 tree;
- exact set comparison between merged local branches and worktree-attached
  branches before deletion.

No production host, provider, database, customer record, deployment or V1
runtime was changed by this cleanup.
