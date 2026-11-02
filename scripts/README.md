# scripts/

Repository tooling, grouped by purpose. Nothing here is imported by the running
application except through the build chain in `package.json` and `Dockerfile`.

| Folder | What lives here |
| --- | --- |
| `release/` | Production release controller (`evo-fast-release.sh`), its CI and ledger gates, env contract, browser smoke, schema ledger, backups and recovery evidence. |
| `checks/` | Read-only checks and audits: `check-*`, `verify-*`, `validate-*`, `audit-*`, `classify-pr-changes.mjs`, provider inventory. |
| `maintenance/` | Operator and timer entrypoints bundled into the image (`*-maintenance.mjs`, `wazzup-ops.mjs`, `waha-runtime-binding.mjs`) and their `build-*` bundlers. |
| `local-dev/` | Local Supabase provisioning, binding and proofs, dev-type cleanup. |
| `import/` | Data import and seed generators (knowledge bundle, WAHA history, sales register, content seeds). |
| `test-runners/` | Test harnesses and runners (`run-*`, `test-*`): Postgres, browser, OrbStack and content tests. |
| `docs/` | Generator and verifier for the platform specification document. |
| `catalog/`, `document-source/`, `knowledge-library/`, `knowledge_ingestion/`, `lib/`, `portal/`, `support/`, `ui/`, `university-template/`, `v3-gate/` | Existing topic folders, unchanged. |

Container paths are unchanged: the image still carries `/app/*-maintenance.mjs`,
`/app/wazzup-ops.mjs`, `/app/scripts/waha-history-import.mjs` and
`/app/scripts/waha-runtime-binding.mjs`. `transcribe_mlx_chunks.py` stays at the
top level because `src/app/api/transcription/jobs/route.ts` and the image use that path.
`knowledge_ingestion/` keeps its underscore because Python imports it as a module.
