# P8C Reconciliation Result - 2026-08-14

Overall result: `blocked` (truthful pre-deployment state).

Candidate image provenance: P8B pull-request head
`0505143657858e710acdd5029f1cc77c5524083e`.

Merged GitHub main: `6ee93bd308aa478357279dd71511c7dc479b1f69`.

Both commits resolve to tree
`0563636057a19949a8927abc3ce02b32ba65896c`.

Ignored deterministic report SHA-256:
`38242d87b1ff589cd5ee0f4dac8e99eef0987ce5e198716beb2ff33634eab900`.

## Segment results

| Segment | Result | Safe finding |
| --- | --- | --- |
| GitHub | `verified` | PR #179 head, squash-main tree and merged-main CI run `31830859008` match. |
| Hermes | `blocked` | CRM/Lead Agent run `564332b4...`; Inbox runs `a09a72fc...`; the P8B candidate is not deployed. All target restart counts are zero and EVO owns the public/private networks. |
| managed Supabase | `verified` | `evo-platform-prod` is `ACTIVE_HEALTHY` in `ap-southeast-1`, PostgreSQL `17.6.1.155`; the read-only ledger contains exactly migrations `001-072`. |
| WAHA | `blocked` | The CRM session is `WORKING` and private, but its webhook still targets the legacy CRM route instead of the Lead Agent route. |
| amoCRM | `blocked` | The base URL and token-file setting exist, but the configured token file is absent and no account/customer API call was made. |
| Gemini | `blocked` | The read-only models API returned `200`, and the candidate default model is available; the explicit candidate runtime model setting is absent on the old deployed Lead Agent. No content-generation call was made. |
| rollback | `blocked` | Existing legacy runtime and prior release directories are retained, but no candidate release directory or candidate rollback bundle is staged on Hermes. |

## Meaning

P8C succeeded as a reconciliation: it found the real differences before any
deployment. `blocked` does not mean production is down. Current containers are
healthy; it means P8D cannot be called a safe exact-candidate deployment until
the listed configuration and rollback gaps are addressed under fresh owner
approval.

No deployment, migration, restart, provider write, WhatsApp send, amoCRM write,
Gemini content call or billed resource creation occurred in P8C.
