# P7B private observability operations

Status: historical implementation procedures under #376/ADR 0020. U11 must
revalidate them before current use; they never authorize enabling a worker or
external write.

These procedures explain how an authorized operator should contain, diagnose,
and verify an incident. They are not permission to deploy, change a provider,
rotate a credential, alter a WAHA session, delete data, or contact a customer.
Those actions still require the normal owner and production authorization.

## Shared safety rules

- Treat `/api/readiness` and `/metrics` as private server-to-server surfaces.
  Never expose them through Caddy or copy their signing secret into a browser,
  ticket, chat, screenshot, command history, or log.
- Correlate work with the response `request_id` and fixed alert/component codes.
  Record only the commit/release SHA, UTC time, fixed code, aggregate value,
  command exit status, and redacted evidence location. Do not record customer
  content, phone numbers, organization IDs, provider payloads, object keys,
  credentials, raw exceptions, or SQL errors.
- Do not delete or rewrite operational evidence. Dead letters, review cases,
  media errors, autonomy outcomes, audit events, and restore reports remain
  append-only evidence even after service recovers.
- A green process-liveness response does not prove dependency readiness. A
  provider/configuration check does not count as real `provider_observed`
  evidence. Synthetic loopback evidence is test evidence only.
- Do not bypass a failed gate to clear an alert. When containment requires a
  feature flag change, make the change only in an authorized incident window,
  record its previous value, preserve the frozen Lead Agent rollback path, and
  verify the exact path again before restoring it.
- P7B sends no page, webhook, email, SMS, or provider request. Escalation is a
  human handoff to the owner category shown below.

## Alert-to-runbook map

| Alerts                                                                                                                                         | Severity            | Owner category        | Runbook                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------- | ----------------------------- |
| `supabase_unavailable`                                                                                                                         | critical            | `server_operator`     | `RB-P7B-SUPABASE-UNAVAILABLE` |
| `queue_backlog_warning`, `queue_backlog_critical`, `queue_expired_lease`, `queue_dead_letter`, `signal_saturated`                              | warning or critical | `server_operator`     | `RB-P7B-QUEUE-BACKLOG`        |
| `unknown_delivery_open`, `provider_conflict_open`                                                                                              | critical            | `whatsapp_operator`   | `RB-P7B-UNKNOWN-DELIVERY`     |
| `waha_unavailable`                                                                                                                             | critical            | `whatsapp_operator`   | `RB-P7B-WAHA-DEGRADED`        |
| `ai_unavailable`                                                                                                                               | critical            | `ai_operator`         | `RB-P7B-AI-UNAVAILABLE`       |
| `private_media_backlog`, `private_media_expired_lease`, `private_media_terminal_error`                                                         | warning or critical | `whatsapp_operator`   | `RB-P7B-PRIVATE-MEDIA`        |
| `audit_append_failed`                                                                                                                          | critical            | `server_operator`     | `RB-P7B-AUDIT-APPEND`         |
| `restore_evidence_missing`, `restore_evidence_failed`                                                                                          | warning or critical | `data_recovery_owner` | `RB-P7B-RESTORE-EVIDENCE`     |
| `autonomy_queue_stalled_warning`, `autonomy_queue_stalled_critical`, `autonomy_dispatch_stalled`, `autonomy_unknown`, `autonomy_manual_review` | warning or critical | `whatsapp_operator`   | `RB-P7B-ROLLBACK-KILL-SWITCH` |

## RB-P7B-SUPABASE-UNAVAILABLE

Owner: `server_operator`.

Trigger: `supabase_unavailable`, or CRM/Inbox component `supabase` is
`unavailable`, `failed`, or `missing`.

1. Confirm process liveness separately. Preserve the signed readiness response,
   fixed component state, request ID, release SHA, and UTC time; do not retain
   the upstream body or credential-bearing headers.
2. Confirm that the configured URL is the intended managed
   `https://<20-character-project-ref>.supabase.co` origin in production. Do not
   substitute a custom, private-network, redirected, or arbitrary HTTPS host.
3. From an authorized private server context, distinguish DNS/TLS/network
   failure, Auth-health failure, and CRM RPC failure. Inspect only bounded
   status codes and fixed component logs. Do not print the anon/service secret.
4. Keep dependent writes and workers fail closed while the database state is
   unknown. Do not fall back to SQLite, another Supabase project, or cached
   success evidence.
5. Recovery requires a new signed readiness request with a new request UUID,
   successful aggregate collection, and the expected dependency evidence. A
   provider dashboard alone is not recovery proof.

Escalate to the data recovery owner as well if database integrity or restore
capability is uncertain. Credential rotation, project failover, or provider
support contact requires separate authorization.

## RB-P7B-QUEUE-BACKLOG

Owner: `server_operator`.

Trigger: queue backlog warning/critical, expired lease, dead letter, or signal
saturation.

1. Record the fixed alert codes and bounded aggregate counts/ages. When
   `signal_saturated` is present, treat the displayed cap as a lower bound—not
   the exact queue size.
2. Separate `ready`, `retry_wait`, `leased`, `expired_lease`, and `dead_letter`.
   Do not acknowledge, delete, or rewrite items merely to make metrics green.
3. Check worker liveness, recent release SHA, bounded logs, lease expiry, and
   the oldest nonterminal age. Correlate by request UUID; do not inspect or copy
   customer payloads into incident notes.
4. If duplicate processing or continued growth is possible, stop only the
   affected worker through its reviewed enable flag during an authorized
   incident window. Preserve ingress and immutable evidence unless the
   specific rollback procedure requires otherwise.
5. Replay or dead-letter recovery requires a separately authorized,
   idempotency-safe procedure. Recovery proof is a later bounded snapshot with
   no expired lease, no unexplained dead letter, falling age/count, and no
   duplicate outcome.

Escalate immediately when counts saturate, a dead letter is unexplained, or an
expired lease can affect outbound delivery.

## RB-P7B-UNKNOWN-DELIVERY

Owner: `whatsapp_operator`.

Trigger: `unknown_delivery_open` or `provider_conflict_open`.

1. Treat an unknown/ambiguous provider result as potentially delivered. Do not
   retry an unknown send result and do not create a replacement send intent.
2. Pause the affected automated-send path through the reviewed kill switch in
   an authorized incident window. Keep the frozen Lead Agent rollback path and
   all ACK/session evidence intact.
3. Use private provider reconciliation and immutable request/ACK/session
   evidence to determine whether delivery is confirmed, failed, or still
   unknown. Never ask a model or local shadow record to decide delivery.
4. A conflicting provider identity, session, message, or idempotency mapping
   remains a human-review case; do not merge or overwrite identifiers.
5. Close review only through the approved reviewed action with actor, reason,
   and time. Verify the open aggregate falls without deleting the underlying
   attempt or audit evidence.

Escalate unresolved delivery to the responsible WhatsApp operator and keep
autonomy paused until the exact conversation/session boundary is verified.

## RB-P7B-WAHA-DEGRADED

Owner: `whatsapp_operator`.

Trigger: `waha_unavailable`, or Inbox/CRM WAHA component is missing,
unverified, stale, failed, or unavailable.

1. Confirm container liveness at unauthenticated private `/ping`; this only
   proves the process is responding and never proves messaging readiness.
2. From an authorized private server context, call authenticated `/health`
   with the server-only `x-api-key`. Accept only HTTP 200 JSON with exact
   top-level `status: "ok"`; never add `health` to the unauthenticated exclusion
   list or publish the WAHA port.
3. Keep autonomous reply transport disabled while session readiness is absent
   or uncertain. Do not infer readiness from configuration, a QR image, an old
   health event, or another WAHA session.
4. Diagnose private networking, container limits, the exact `evo-inbox`
   session, and bounded logs without recording API keys, QR/session material,
   phone numbers, message data, or provider bodies.
5. Recovery requires a new authenticated health result plus fresh accepted
   provider-observed evidence where the CRM aggregate requires it. A loopback
   stub is never production recovery evidence.

QR relinking, session recreation, webhook change, or live send requires the
named production owner and separate authorization.

## RB-P7B-AI-UNAVAILABLE

Owner: `ai_operator`.

Trigger: `ai_unavailable`, or required AI evidence is missing, unverified,
stale, failed, blocked, future-dated, or unavailable.

1. Keep autonomous replies disabled and route the conversation to human
   review. Never send model output merely because provider configuration is
   present.
2. Record only the fixed component/evidence state, age, request UUID, release
   SHA, and UTC time. Do not record prompts, customer content, model output,
   provider responses, API keys, or arbitrary exception text.
3. Distinguish missing configuration, blocked policy, stale/future evidence,
   network/provider failure, and invalid structured output using bounded safe
   codes. Do not relabel local or configuration evidence as
   `provider_observed`.
4. Provider retry or credential rotation follows its separately authorized
   policy. An uncertain language, unsupported content, complaint, payment,
   legal/privacy question, or guarantee request remains human-owned even after
   provider recovery.
5. Recovery requires fresh accepted provider-observed health evidence and a
   subsequent signed readiness result. It does not authorize a customer send.

Escalate policy or data-handling uncertainty before exercising the provider.

## RB-P7B-PRIVATE-MEDIA

Owner: `whatsapp_operator`.

Trigger: private media backlog, expired media lease, or terminal media error.

1. Record only aggregate state/count/age, saturation, request UUID, and fixed
   alert code. Never copy the object key, signed URL, sender, filename, content,
   or storage/provider payload into incident notes.
2. Separate `pending`, `processing`, `retryable_error`, `terminal_error`, and
   `expired_lease`. A media-only inbound remains valid customer evidence and
   must reach operator-visible human review; it is not a successful no-op.
3. Check worker liveness, private Storage reachability, lease ownership,
   retention safety, and bounded logs. Do not download customer media for a
   generic health check.
4. If processing could duplicate or lose evidence, disable only
   `EVO_PLATFORM_WAHA_MEDIA_ENABLED` in an authorized incident window. Do not
   delete archive work, source events, review cases, or terminal errors.
5. Recovery requires an idempotent reviewed retry or human disposition and a
   later aggregate showing no unexplained expired lease/terminal error. A lower
   count caused by deletion is not recovery.

Escalate any possible unauthorized access, retention breach, or missing object
to the security/data owner immediately.

## RB-P7B-AUDIT-APPEND

Owner: `server_operator`.

Trigger: `audit_append_failed`, or the rolled-back append probe is `failed` or
`unavailable`.

1. Treat the audit path as unavailable even if application liveness is green.
   Stop or contain operations whose approved contract requires an audit event;
   do not add a bypass or write an unaudited replacement record.
2. Preserve the signed readiness response, request UUID, release SHA, UTC time,
   and fixed failure code. Never expose the SQL error or probe values.
3. Verify database reachability, grants/ownership, append-only guards, required
   organization availability, and migration state from an authorized private
   context. The probe deliberately rolls back; absence of a durable probe row
   is expected.
4. Do not weaken RLS, triggers, `SECURITY DEFINER` ownership, or browser grants
   to make the probe pass. Correct schema defects only through a reviewed
   additive migration.
5. Recovery requires the rolled-back probe to report `ready` and focused audit
   authorization/append-only tests to pass at the exact release SHA.

Escalate any evidence that audit history changed, disappeared, or became
browser-writable as a security incident.

## RB-P7B-RESTORE-EVIDENCE

Owner: `data_recovery_owner`.

Trigger: `restore_evidence_missing` warning or `restore_evidence_failed`
critical for Database or Storage.

1. Remember that restore evidence is separate from runtime readiness. `missing`
   must remain visible until P7C supplies reviewed real evidence; configuration,
   a backup file, or a successful database-only check is not a restore proof.
2. Identify whether Database, Storage, or both lack evidence. Database backups
   do not include Storage objects, so never infer one from the other.
3. Do not run a production restore from this alert. Schedule the separately
   authorized isolated restore drill with exact source snapshot, destination,
   owner, time, integrity checks, and cleanup boundary.
4. A failed drill preserves its logs and artifacts. Do not overwrite the failed
   report with a later result or delete it to clear the alert.
5. Recovery evidence requires the accepted P7C procedure and immutable
   Database/Storage results at the exact tested revision. Until then, the
   warning is truthful and expected.

Escalate failed integrity, unavailable backups, missing encryption material, or
an uncertain recovery point immediately; do not estimate an RPO/RTO.

## RB-P7B-ROLLBACK-KILL-SWITCH

Owner: `whatsapp_operator`.

Trigger: stalled queued/dispatching autonomy, unknown outcome, manual review,
or any safety condition requiring immediate autonomous-send containment.

1. For critical or unknown outcomes, set the reviewed global autonomous reply
   enablement to disabled in an authorized incident window and verify the
   running release actually consumed the change. Do not disable or retire the
   frozen Lead Agent rollback path.
2. If the incident is in receive/project or media work, disable only the
   corresponding reviewed worker flag needed for containment. Keep raw inbound,
   queue, intent, decision, ACK/session, review, and audit evidence intact.
3. Do not retry an unknown send result, reuse an idempotency key, clear a pause,
   or let a model/provider response resume autonomy. Only an authorized staff
   actor may resume, with reason and time audited.
4. Reconcile every `dispatching` or `unknown` intent against private provider
   evidence before deciding its outcome. Customer contact, a test send, WAHA
   session mutation, or webhook cutover needs separate authority.
5. Recovery requires zero unexplained dispatch/unknown state, reviewed human
   disposition, exact gate tests, and an authorized decision to re-enable. A
   falling count caused by row deletion or silent acknowledgement is invalid.

Escalate immediately when a duplicate send is possible, the kill switch is not
effective, or evidence cannot determine whether transport occurred.

## Closing evidence

For every incident, retain a redacted record of the alert code, owner, request
UUID, release SHA, UTC start/end, containment decision, verification result,
and remaining blocker. Never describe a local stub, configuration check, old
event, or skipped command as provider or production proof.

## References

- [P7B private observability implementation contract](../platform/p7b-observability-contract.md)
- [WAHA observability](https://waha.devlike.pro/docs/how-to/observability/)
- [WAHA security](https://waha.devlike.pro/docs/how-to/security/)
- [Supabase Auth health response](https://supabase.com/docs/guides/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR)
