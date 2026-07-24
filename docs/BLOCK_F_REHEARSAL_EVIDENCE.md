# Block F disaster-recovery rehearsal evidence

Evidence date: 2026-07-24 UTC. Host: `hermes-vps`. This file contains only
sanitized metadata. No secret values, customer data, object names, session
identifiers, or backup artifacts are retained in Git.

## Production inventory (read-only)

- Main CRM: one WAL-mode SQLite database in `evo-crm_evo_crm_data`; three files,
  about 4.29 MB at inventory time.
- Lead Agent: one WAL-mode SQLite database in
  `evo-crm_evo_crm_lead_agent_data`; three files, about 135 KB.
- Main CRM output volume: empty at inventory time.
- Main CRM and Inbox each have a private WAHA session volume. The volume sizes
  were about 236 MB and 189 MB respectively. File names were not retained.
- Inbox uses managed Supabase and the running app has API URL/anonymous/service
  role variable names. No PostgreSQL password, Supabase Management API token,
  isolated project/database, or Storage S3 credentials were found in the
  authorized runtime inventory.
- Exact first-party release revisions were discoverable from running image
  tags. Root-owned deployment environment files exist, but some legacy copies
  are mode `0644`; this is a recovery risk and must be corrected through a
  separately authorized production configuration change.

## Rehearsal results

| Gate | Result | Measured result |
|---|---|---|
| Main CRM SQLite | PASS | Online backup in 22 ms; 135,168 bytes; 17 application tables; integrity and foreign-key checks passed |
| Main CRM application read / encrypted settings | PASS | Restored database contained two ciphertext settings; both decrypted through the real application `decryptRuntimeSecret` path in an isolated production-image container; plaintext was not printed |
| Main CRM generated files | PASS (empty store) | production output volume contained zero files; no recovery artifact was necessary |
| Lead Agent SQLite/token state | PASS | Online backup in 11 ms; 102,400 bytes; 7 application tables; integrity and foreign-key checks passed |
| Lead Agent application read | PASS | real `evo-lead-agent-readiness` read the isolated restored database and found 12 retained knowledge records; provider configuration was intentionally absent in the network-isolated verifier |
| CRM WAHA material | PARTIAL | protected live archive: 233,328,640 bytes, 478 archive entries, 2 seconds; isolated extraction passed. A live archive is not claimed transactionally consistent |
| Inbox WAHA material | PARTIAL | protected live archive: 191,651,840 bytes, 1,403 archive entries, 3 seconds; isolated extraction passed. A live archive is not claimed transactionally consistent |
| WAHA relink | DOCUMENTED, NOT EXECUTED | live sessions were not logged out or relinked; owner QR availability is required during an incident |
| Supabase PostgreSQL | BLOCKED | runtime has API/service-role configuration but no authorized PostgreSQL password or Management API token, and no isolated destination project/database exists |
| Supabase Storage objects | BLOCKED | no authenticated S3/object-export credentials and no isolated destination project/bucket exist; database backup cannot substitute because it contains metadata only |
| Exact release/secret configuration | PASS | 10 explicit environment/Compose/Caddy files archived in 0 seconds (30,720 bytes), extracted in isolation, and every restored checksum matched; no value or checksum was logged |

All successful rehearsals ran on `hermes-vps` with production volumes mounted
read-only, no external network, and isolated temporary destinations. No
production container was stopped, replaced, reconfigured, or restored into.
The exact temporary directory and its databases, WAHA archives, extracted
trees, manifests, and transient environment copy were deleted after sanitized
results were recorded. Cleanup was independently confirmed.

The proposed RPO/RTO table in `docs/DISASTER_RECOVERY.md` remains pending
business-owner approval.

## Evidence retention

Temporary artifacts live only in a root-owned `0700` directory under
`/var/tmp`, with files mode `0600`. After checksum/integrity evidence is
recorded, the exact directory is securely removed. Sanitized pass/fail,
counts/sizes, tool version, and elapsed time remain here; raw databases,
archives, manifests with sensitive names, and runtime output do not.
