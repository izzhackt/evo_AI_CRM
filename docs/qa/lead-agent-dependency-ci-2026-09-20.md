# Lead-agent dependency CI — 20 September 2026

Block A-1, items 4/34. Code base: `3ac6f326ca9f89de980b985746ba8effd864d264`.
This changes CI classification and validation; it does not update a production
dependency, deploy the service or exercise amoCRM/WAHA/provider credentials.

## Contract

Only `evo-lead-agent/pyproject.toml` and `evo-lead-agent/uv.lock` enter the new
dependency lane. Other unclassified Python paths remain unknown and fail the
required Fast checks gate. Changes to the smoke script or the fast-PR workflow
also select this lane. Mixed changes retain their other selected checks.

The lane uses the same Python 3.13 image digest and uv 0.11.7 as the existing
lead-agent Dockerfile. `uv sync --locked --no-dev` must succeed without changing
the lockfile, followed by `uv pip check` and the real HTTP runtime smoke.
Failure, cancellation or an unexpectedly skipped selected lane blocks Fast checks.

## Local execution

Environment: Node 22.23.1, Python 3.13.0, uv 0.11.7 on macOS. Both dependency
sets below passed locked sync, compatibility check and the same smoke script:

| Dependency source | AnyIO | Result |
|---|---|---|
| Main `3ac6f326ca9f89de980b985746ba8effd864d264` | 4.14.1 | PASS |
| PR #847 `bb673d4b772d017a01d219249060e4aeb5996fdc` | 4.14.2 | PASS |

From each source's `evo-lead-agent` directory, the executed sequence was
`uv sync --locked --no-dev --python 3.13`, `uv pip check`, then
`uv run --locked --no-dev python <A-1>/scripts/smoke-lead-agent-dependencies.py`.
The second worktree used the identical A-1 script by absolute path. Neither
dependency source's tracked files were changed by these commands.

The smoke starts the actual Uvicorn/FastAPI application on a reserved loopback
socket and uses HTTPX through AnyIO. It checks live health, request-id propagation,
unknown-route 404, frozen webhook rejection and the unconfigured admin guard.
The child receives an allowlisted environment, disabled dotenv/worker/starter
knowledge and a temporary SQLite database. No customer records, seed data,
provider calls or runtime credentials are used. This proves the exercised local
HTTP/import/guard paths, not operational lead delivery or advisory exploit tests.

Final targeted checks: classifier **24/24**, actual Fast checks shell plus active
workflow contract **2/2**, scoped ESLint and `git diff --check`. The existing full
`npm run lint` also passed earlier in the same worktree; its source scope was
unchanged except the subsequently checked classifier trigger regression.
Full Node, Supabase and browser suites were not run for this CI-only slice.

The classifier/gate regression cases exercise dispatch and failure selection;
they are not provider or production acceptance. GitHub's Linux container result
and independent exact-head review must be read from the resulting PR before merge.
The older red #847 run is not relabelled green by these local checks.

## Reference

[uv locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/), checked
20 September 2026: `--locked` rejects stale lock metadata instead of rewriting it.
