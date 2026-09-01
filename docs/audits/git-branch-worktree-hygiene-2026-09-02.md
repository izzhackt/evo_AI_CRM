# Git branch and worktree hygiene audit — 2026-09-02

## Outcome

The stale-pr concern from the 2026-08-23 snapshot is resolved: immediately
before this audit PR was opened, GitHub had zero pre-existing open pull
requests. No old PR was merged blindly, and there was no stale open PR to
close. PR #558 is the later delivery vehicle for this evidence and is excluded
from that cleanup snapshot.

Cleanup removed only two targets with complete recoverability proof:

1. clean detached worktree `/private/tmp/evo-ux-audit.NRAwKZ`, whose commit
   `f87bd37fa4ed2b88b35fc2a263459f5d1bcff0a0` is already contained in
   `origin/main`;
2. local branch `izzhackt/v2-supabase-successor-plan`, whose tree exactly
   matched `origin/main` and whose exact head was merged through PR #554.
   GitHub had already removed the corresponding remote branch.

The removed worktree directory is no longer present and is no longer
registered by Git. The branch is no longer present under local or remote
heads. Its content remains recoverable from `main`, PR #554 and GitHub.

## Inventory before and after

| Check | Measured immediately before removal | Clean PR head after cleanup |
| --- | ---: | ---: |
| Pre-existing open GitHub PRs, excluding this audit PR | 0 | 0 |
| Registered worktrees | 113 | 112 |
| Clean worktrees | 103 | 103 |
| Dirty worktrees | 10 | 9 |

The #545 worktree contained four intentional documentation changes when the
pre-removal count was measured, so it was then counted as dirty. It became
clean when those changes were committed. The cleanup itself removed one clean
worktree; it did not discard any dirty work.

## Dirty work preserved

The following unrelated dirty worktrees were not changed, cleaned, stashed or
deleted:

```text
/Users/iskhak.tazhibaev/Documents/01_Projects/evo_AI_CRM
/private/tmp/evo-v2-432b.0Fr27n
/private/tmp/evo-v2-9b.IjmBwV
/private/tmp/evo-v2-9c-impl.CCPLnR
/Users/iskhak.tazhibaev/.codex/worktrees/e9a7/evo_AI_CRM
/Users/iskhak.tazhibaev/.codex/worktrees/evo-longrun-382
/Users/iskhak.tazhibaev/.codex/worktrees/evo-p2r4-local-migration-repair
/Users/iskhak.tazhibaev/.codex/worktrees/evo-v1-v2-plan-Yxbw2H
/Users/iskhak.tazhibaev/Documents/01_Projects/evo_AI_CRM-pr40-review
```

The main project checkout at
`/Users/iskhak.tazhibaev/Documents/01_Projects/evo_AI_CRM` remains on
`izzhackt/evo-inbox-folder-rename` with 18 changed/untracked entries. It is user
work, not a cleanup target.

## Why the other clean worktrees remain

A clean worktree is not automatically disposable. Many remaining worktrees
point to unique commits that are not represented by the current `main` tree,
and some may back existing Codex tasks. A squash-merged repository also cannot
classify safety from `git branch --merged` alone.

The remaining clean set therefore needs exact per-branch stale triage using PR
state, exact head/tree comparison, active-task ownership and remote
recoverability. Mass removal or `git branch -D` would risk deleting unfinished
or still-referenced work. No remote branch was deleted by this cleanup.

## Repeatable removal rule

A future cleanup target is safe only when all of these are proved together:

1. the worktree is clean;
2. no process or active task owns it;
3. its exact commit or tree is already in `main`, or the exact branch head is
   preserved remotely by a merged/closed PR;
4. it is not a dependency of an open branch or PR;
5. the exact path and branch are named before removal;
6. post-removal checks prove the path/registration is gone and the content is
   still recoverable.

Dirty worktrees are preserve-by-default. They require their own content
inventory and an explicit keep/commit/archive decision; they must never be
silently reset, stashed or deleted.
