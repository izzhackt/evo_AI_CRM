# Greenfield Platform Boundary

This note summarizes the active boundary for EVO Platform implementation.

- Platform backend: greenfield, Supabase-native.
- No legacy SQLite data import.
- No legacy account import.
- No root-auth migration into Platform.
- No dual-read or dual-write bridge.
- Existing unified frontend from PRs #64/#71/#72 stays the only product UI.
- First slice: operator messaging only.
- Reused messaging scope: conversation list/thread, necessary context, WAHA
  receive/send, ACK/delivery, AI draft, manual send, approved knowledge, audit,
  minimal health/settings.
- Excluded first-slice scope: Inbox CRM/dashboard/pipeline/deal/lead/
  broadcast/flow/campaign/unrelated analytics/settings surfaces.
- P1 is historical legacy containment. P2A-P2H are reusable foundation. Former
  P2I restore duties move to P7.
- Cutover evidence: bounded reconciliation window, zero unexplained
  loss/duplicates, health and rollback proof.
