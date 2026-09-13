# Document recognition worker

Candidate operation contract,2026-09-14; not activation or provider acceptance.

The normal app build produces `.next/document-recognition-worker.mjs`. The final
production image contains `/app/document-recognition-worker.mjs` alongside its
existing fixed `/opt/evo-document-runtime` inspector. Use the exact reviewed app
image/revision, existing private network and authorized server-side environment.
Do not run the source with an alternative inspector or install another runtime.

Explicit commands inside that image, only after the separate provider gate:

```sh
node /app/document-recognition-worker.mjs --once --mode processing --worker-id admissions-processing
node /app/document-recognition-worker.mjs --once --mode cleanup --worker-id admissions-cleanup
```

Each command claims at most one record. There is no scheduler or automatic
follow-up invocation. Processing uses the existing DB-resolved model, paid-project
approval, policy and budget snapshot; no model argument or default is accepted.
Required secrets are the existing `EVO_PLATFORM_GEMINI_API_KEY` and
`EVO_PLATFORM_SUPABASE_SECRET_KEY`, with `NEXT_PUBLIC_SUPABASE_URL`.
Pass secrets using the existing protected server environment, never command-line
arguments. Missing or malformed configuration stops before a claim.
Cleanup needs those credentials and the saved cleanup binding, but neither new
processing authority nor an available source inspector. It checks/removes only
the persisted owned provider file and never generates or reads a source file.

Processing has a240000ms deadline; cleanup90000ms. `--timeout-ms <positive integer>`
may reduce that limit, never increase it. SIGINT/SIGTERM or deadline expiration
aborts awaited work; if it ignores cancellation, the process exits after5000ms
grace. Signals/timeouts do not prove a provider operation was cancelled or free.
Reconcile the durable outcome under the existing lease/intent rules; never add a
blind retry of upload or generation. A supervisor must allow at least6s shutdown
grace and invoke Node directly using exec-form arguments so it receives signals.

One JSON summary contains only schema, mode, outcome, state and failure_code.
No identifiers, document values, provider URI, raw errors or credential values
are logged. Exit status is0 for idle or successful settled work,1 for a settled
processing failure,64 for invalid arguments,69 for unavailable work,75 for a
deferred outcome,78 for missing configuration,124 for deadline,130 for SIGINT,
and143 for SIGTERM. `--help` is local and does not construct a backend client.

Official behavior checked2026-09-14:

- [Node22 signals](https://nodejs.org/docs/latest-v22.x/api/process.html#signal-events): installing a listener removes the default termination behavior, so the CLI owns abort and hard-stop handling.
- [Node22 exit/exitCode](https://nodejs.org/docs/latest-v22.x/api/process.html#processexitcode): normal completion uses exitCode; the exceptional watchdog writes its fixed summary synchronously before forced exit, because forced exit may truncate pending output.
- [Docker exec-form](https://docs.docker.com/reference/dockerfile/#entrypoint): a shell wrapper can prevent signal delivery. The shipped server command remains unchanged; any later worker scheduling must invoke the bundle directly.

Validation is scoped CLI behavior, actual bundle no-config/invalid-argument
execution and one Next build. This does not prove image/native inspection,
Auth/Storage/browser integration, a paid provider result or confirmed cleanup.
Those remain separate gates in the [D3 contract](design/v3/evo-docs-recognition-contract.md).

Local candidate receipts:

- Final focused worker/cleanup/CLI/manifest37/37 passed (`01a09ca5fa3f7bd19350fa9c36c3cc34`); canonical plans include this test once, CI322/183/139 and unit220/178/42 (occurrences/unique/duplicates). Existing source-TS tests emit MODULE_TYPELESS_PACKAGE_JSON warnings; the shipped `.mjs` bundle needs no strip-types/runtime import hook.
- CLI8/8 passed (`01a09ca4732575b390723672df919723`), including actual signal/watchdog children and bundle execution from a temporary directory without source/node_modules. The initial bundle test exposed a symlink entrypoint comparison; the corrected entry resolves the real path before comparing.
- One actual `npm run build` passed with TypeScript and both CLI bundles (`01a09ca501087e71930f9ce932600579`). No separate typecheck/full DB/browser suite was run.
- Actual Next-output bundle returned expected78 for missing configuration in processing and cleanup (`01a09ca554357d52b9fde7b2dc9691d3`, `01a09ca554667aa1af3900514cd1d572`), and64 for invalid mode (`01a09ca5545d7c92b43601ccc37bfea2`). No credentials were supplied and no claim/provider operation ran.
- Scoped ESLint/diff-check passed (`01a09ca4bdd47d3386ca0d6a18d3df6d`). Bundle2647902 bytes, SHA256 `5137cd9e9a2fadbeb4b40e9b18e923b1d8a19744970f5decc26fc0ff4683d136` (`01a09ca554507e72832bc6be81e93ade`). Docker COPY was inspected, not executed.
