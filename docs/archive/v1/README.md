# Frozen V1 deployment and recovery material

Status: historical rollback and decision input only.

Nothing in this directory is an active EVO release instruction. Do not execute,
import, bundle, source, or use these files to configure the V2 production
successor. They retain the former V1/companion topology so an explicitly
authorized incident or cutover review can reconstruct what existed before the
successor contract.

The active successor sources are:

- `deploy/README.md` for the runtime boundary;
- `deploy/production-release.md` for the controlled exact-SHA release process;
- `deploy/runtime-hardening.md` for health, privacy, and resource rules; and
- `docs/DISASTER_RECOVERY.md` for the managed-Supabase recovery contract.

Any real production deployment, rollback, provider mutation, customer-data
operation, WAHA session change, or cutover still requires its own current plan
and explicit owner authorization.
