import type {
  PlatformDependencyEvidenceKind,
  PlatformDependencyReadiness,
  PlatformOperationalSignals,
} from "./platform-operational-signals.ts";

export type PlatformComponentStatus =
  | "ready"
  | "failed"
  | "unavailable"
  | "missing"
  | "unverified"
  | "stale";

export type PlatformComponent = Readonly<{
  status: PlatformComponentStatus;
  age_seconds: number | null;
}>;

export type PlatformRestoreComponent = Readonly<{
  status: "missing" | "failed" | "ready";
  age_seconds: number | null;
}>;

export type PlatformComponents = Readonly<{
  supabase: PlatformComponent;
  audit_append: PlatformComponent;
  waha: PlatformComponent;
  ai: PlatformComponent;
  restore_database: PlatformRestoreComponent;
  restore_storage: PlatformRestoreComponent;
}>;

export type PlatformAlertSeverity = "warning" | "critical";
export type PlatformAlertOwnerCategory =
  | "server_operator"
  | "whatsapp_operator"
  | "ai_operator"
  | "data_recovery_owner";

export type PlatformOperationalAlert = Readonly<{
  code: PlatformOperationalAlertCode;
  severity: PlatformAlertSeverity;
  owner_category: PlatformAlertOwnerCategory;
  runbook_id: string;
}>;

const ALERT_DEFINITIONS = {
  supabase_unavailable: [
    "critical",
    "server_operator",
    "RB-P7B-SUPABASE-UNAVAILABLE",
  ],
  audit_append_failed: [
    "critical",
    "server_operator",
    "RB-P7B-AUDIT-APPEND",
  ],
  waha_unavailable: [
    "critical",
    "whatsapp_operator",
    "RB-P7B-WAHA-DEGRADED",
  ],
  ai_unavailable: ["critical", "ai_operator", "RB-P7B-AI-UNAVAILABLE"],
  queue_backlog_warning: [
    "warning",
    "server_operator",
    "RB-P7B-QUEUE-BACKLOG",
  ],
  queue_backlog_critical: [
    "critical",
    "server_operator",
    "RB-P7B-QUEUE-BACKLOG",
  ],
  queue_expired_lease: [
    "critical",
    "server_operator",
    "RB-P7B-QUEUE-BACKLOG",
  ],
  queue_dead_letter: [
    "critical",
    "server_operator",
    "RB-P7B-QUEUE-BACKLOG",
  ],
  unknown_delivery_open: [
    "critical",
    "whatsapp_operator",
    "RB-P7B-UNKNOWN-DELIVERY",
  ],
  provider_conflict_open: [
    "critical",
    "whatsapp_operator",
    "RB-P7B-UNKNOWN-DELIVERY",
  ],
  private_media_backlog: [
    "warning",
    "whatsapp_operator",
    "RB-P7B-PRIVATE-MEDIA",
  ],
  private_media_expired_lease: [
    "critical",
    "whatsapp_operator",
    "RB-P7B-PRIVATE-MEDIA",
  ],
  private_media_terminal_error: [
    "critical",
    "whatsapp_operator",
    "RB-P7B-PRIVATE-MEDIA",
  ],
  autonomy_queue_stalled_warning: [
    "warning",
    "whatsapp_operator",
    "RB-P7B-ROLLBACK-KILL-SWITCH",
  ],
  autonomy_queue_stalled_critical: [
    "critical",
    "whatsapp_operator",
    "RB-P7B-ROLLBACK-KILL-SWITCH",
  ],
  autonomy_dispatch_stalled: [
    "critical",
    "whatsapp_operator",
    "RB-P7B-ROLLBACK-KILL-SWITCH",
  ],
  autonomy_unknown: [
    "critical",
    "whatsapp_operator",
    "RB-P7B-ROLLBACK-KILL-SWITCH",
  ],
  autonomy_manual_review: [
    "warning",
    "whatsapp_operator",
    "RB-P7B-ROLLBACK-KILL-SWITCH",
  ],
  restore_evidence_missing: [
    "warning",
    "data_recovery_owner",
    "RB-P7B-RESTORE-EVIDENCE",
  ],
  restore_evidence_failed: [
    "critical",
    "data_recovery_owner",
    "RB-P7B-RESTORE-EVIDENCE",
  ],
  signal_saturated: [
    "critical",
    "server_operator",
    "RB-P7B-QUEUE-BACKLOG",
  ],
} as const;

export type PlatformOperationalAlertCode = keyof typeof ALERT_DEFINITIONS;

export type PlatformReadiness = Readonly<{
  schema_version: "p7b-v1";
  ok: boolean;
  status: "ready" | "not_ready";
  service: "evo-crm";
  request_id: string;
  observed_at: string;
  components: PlatformComponents;
  signals: PlatformOperationalSignals | null;
  alerts: readonly PlatformOperationalAlert[];
}>;

function component(
  status: PlatformComponentStatus,
  ageSeconds: number | null,
): PlatformComponent {
  return Object.freeze({ status, age_seconds: ageSeconds });
}

function restoreComponent(
  status: PlatformRestoreComponent["status"],
  ageSeconds: number | null,
): PlatformRestoreComponent {
  return Object.freeze({ status, age_seconds: ageSeconds });
}

function normalizeDependency(
  readiness: PlatformDependencyReadiness,
  evidenceKind: PlatformDependencyEvidenceKind | null,
  ageSeconds: number | null,
  evidenceFuture: boolean,
): PlatformComponent {
  if (evidenceFuture) return component("failed", ageSeconds);
  if (ageSeconds === null) return component("missing", null);
  if (readiness === "blocked") return component("failed", ageSeconds);
  if (readiness !== "ready" || evidenceKind !== "provider_observed") {
    return component("unverified", ageSeconds);
  }
  if (ageSeconds > 300) return component("stale", ageSeconds);
  return component("ready", ageSeconds);
}

function fixedAlert(code: PlatformOperationalAlertCode): PlatformOperationalAlert {
  const [severity, ownerCategory, runbookId] = ALERT_DEFINITIONS[code];
  return Object.freeze({
    code,
    severity,
    owner_category: ownerCategory,
    runbook_id: runbookId,
  });
}

function atLeast(value: number | null, threshold: number): boolean {
  return value !== null && value >= threshold;
}

export function evaluatePlatformOperationalAlerts(input: Readonly<{
  signals: PlatformOperationalSignals | null;
  components: PlatformComponents;
}>): readonly PlatformOperationalAlert[] {
  const codes = new Set<PlatformOperationalAlertCode>();
  const { components, signals } = input;

  if (components.supabase.status === "unavailable") {
    codes.add("supabase_unavailable");
  }
  if (
    components.audit_append.status === "failed" ||
    components.audit_append.status === "unavailable"
  ) {
    codes.add("audit_append_failed");
  }
  if (components.waha.status !== "ready") codes.add("waha_unavailable");
  if (components.ai.status !== "ready") codes.add("ai_unavailable");

  const restoreStatuses = [
    components.restore_database.status,
    components.restore_storage.status,
  ];
  if (restoreStatuses.includes("failed")) {
    codes.add("restore_evidence_failed");
  } else if (restoreStatuses.includes("missing")) {
    codes.add("restore_evidence_missing");
  }

  if (signals) {
    const queueBacklog =
      signals.queue_ready_count + signals.queue_retry_wait_count;
    const queueCritical =
      queueBacklog >= 100 ||
      atLeast(signals.queue_oldest_ready_age_seconds, 900) ||
      atLeast(signals.queue_oldest_retry_wait_age_seconds, 900);
    const queueWarning =
      queueBacklog >= 25 ||
      atLeast(signals.queue_oldest_ready_age_seconds, 300) ||
      atLeast(signals.queue_oldest_retry_wait_age_seconds, 300);
    if (queueCritical) codes.add("queue_backlog_critical");
    else if (queueWarning) codes.add("queue_backlog_warning");

    if (signals.queue_expired_lease_count > 0) {
      codes.add("queue_expired_lease");
    }
    if (signals.dead_letter_count > 0) codes.add("queue_dead_letter");
    if (signals.unknown_delivery_open_count > 0) {
      codes.add("unknown_delivery_open");
    }
    if (signals.provider_conflict_open_count > 0) {
      codes.add("provider_conflict_open");
    }

    if (
      signals.private_media_pending_count >= 25 ||
      signals.private_media_retryable_error_count >= 25 ||
      atLeast(signals.private_media_oldest_unarchived_age_seconds, 300)
    ) {
      codes.add("private_media_backlog");
    }
    if (signals.private_media_expired_lease_count > 0) {
      codes.add("private_media_expired_lease");
    }
    if (signals.private_media_terminal_error_count > 0) {
      codes.add("private_media_terminal_error");
    }

    const autonomyQueueCritical = atLeast(
      signals.autonomy_oldest_queued_age_seconds,
      900,
    );
    const autonomyQueueWarning = atLeast(
      signals.autonomy_oldest_queued_age_seconds,
      300,
    );
    if (autonomyQueueCritical) codes.add("autonomy_queue_stalled_critical");
    else if (autonomyQueueWarning) {
      codes.add("autonomy_queue_stalled_warning");
    }
    if (atLeast(signals.autonomy_oldest_dispatching_age_seconds, 300)) {
      codes.add("autonomy_dispatch_stalled");
    }
    if (signals.autonomy_unknown_count > 0) codes.add("autonomy_unknown");
    if (signals.autonomy_manual_review_count > 0) {
      codes.add("autonomy_manual_review");
    }
    if (signals.saturated) codes.add("signal_saturated");
  }

  return Object.freeze(
    [...codes]
      .map(fixedAlert)
      .sort((left, right) => {
        if (left.severity !== right.severity) {
          return left.severity === "critical" ? -1 : 1;
        }
        return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
      }),
  );
}

export function composePlatformReadiness(input: Readonly<{
  signals: PlatformOperationalSignals | null;
  requestId: string;
  fallbackObservedAt: string;
  restoreDatabase?: PlatformRestoreComponent;
  restoreStorage?: PlatformRestoreComponent;
}>): PlatformReadiness {
  const { signals } = input;
  const components: PlatformComponents = signals
    ? Object.freeze({
        supabase: component("ready", null),
        audit_append: component(signals.audit_append_status, null),
        waha: normalizeDependency(
          signals.waha_readiness,
          signals.waha_evidence_kind,
          signals.waha_age_seconds,
          signals.waha_evidence_future,
        ),
        ai: normalizeDependency(
          signals.ai_readiness,
          signals.ai_evidence_kind,
          signals.ai_age_seconds,
          signals.ai_evidence_future,
        ),
        restore_database:
          input.restoreDatabase ?? restoreComponent("missing", null),
        restore_storage:
          input.restoreStorage ?? restoreComponent("missing", null),
      })
    : Object.freeze({
        supabase: component("unavailable", null),
        audit_append: component("unavailable", null),
        waha: component("unverified", null),
        ai: component("unverified", null),
        restore_database:
          input.restoreDatabase ?? restoreComponent("missing", null),
        restore_storage:
          input.restoreStorage ?? restoreComponent("missing", null),
      });

  const ok =
    components.supabase.status === "ready" &&
    components.audit_append.status === "ready" &&
    components.waha.status === "ready" &&
    components.ai.status === "ready";
  const alerts = evaluatePlatformOperationalAlerts({ signals, components });

  return Object.freeze({
    schema_version: "p7b-v1",
    ok,
    status: ok ? "ready" : "not_ready",
    service: "evo-crm",
    request_id: input.requestId,
    observed_at: signals?.observed_at ?? input.fallbackObservedAt,
    components,
    signals,
    alerts,
  });
}

type MetricSample = Readonly<{
  labels?: string;
  value: number;
}>;

function metricFamily(
  name: string,
  help: string,
  samples: readonly MetricSample[],
): string[] {
  return [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} gauge`,
    ...samples.map(
      ({ labels, value }) => `${name}${labels ? `{${labels}}` : ""} ${value}`,
    ),
  ];
}

export function renderPlatformMetrics(readiness: PlatformReadiness): string {
  const lines: string[] = [];
  const add = (family: string[]) => lines.push(...family);
  const componentSamples = (
    ["supabase", "audit_append", "waha", "ai"] as const
  ).map((name) => ({
    labels: `component="${name}"`,
    value: readiness.components[name].status === "ready" ? 1 : 0,
  }));

  add(
    metricFamily(
      "evo_platform_readiness",
      "Whether required EVO Platform dependencies are ready.",
      [{ value: readiness.ok ? 1 : 0 }],
    ),
  );
  add(
    metricFamily(
      "evo_platform_component_ready",
      "Whether a required EVO Platform component is ready.",
      componentSamples,
    ),
  );

  if (readiness.signals) {
    const signals = readiness.signals;
    const ageSamples = (["waha", "ai"] as const).flatMap((name) => {
      const age = readiness.components[name].age_seconds;
      return age === null
        ? []
        : [{ labels: `component="${name}"`, value: age }];
    });
    add(
      metricFamily(
        "evo_platform_component_age_seconds",
        "Age of the latest dependency evidence in seconds.",
        ageSamples,
      ),
    );
    add(
      metricFamily(
        "evo_platform_queue_items",
        "Current durable queue items by state.",
        [
          { labels: 'state="ready"', value: signals.queue_ready_count },
          {
            labels: 'state="retry_wait"',
            value: signals.queue_retry_wait_count,
          },
          { labels: 'state="leased"', value: signals.queue_leased_count },
          {
            labels: 'state="expired_lease"',
            value: signals.queue_expired_lease_count,
          },
          { labels: 'state="dead_letter"', value: signals.dead_letter_count },
        ],
      ),
    );
    add(
      metricFamily(
        "evo_platform_queue_oldest_age_seconds",
        "Oldest durable queue item age in seconds by waiting state.",
        [
          ...(signals.queue_oldest_ready_age_seconds === null
            ? []
            : [{
                labels: 'state="ready"',
                value: signals.queue_oldest_ready_age_seconds,
              }]),
          ...(signals.queue_oldest_retry_wait_age_seconds === null
            ? []
            : [{
                labels: 'state="retry_wait"',
                value: signals.queue_oldest_retry_wait_age_seconds,
              }]),
        ],
      ),
    );
    add(
      metricFamily(
        "evo_platform_review_items",
        "Open operational review items by state.",
        [
          {
            labels: 'state="unknown_delivery"',
            value: signals.unknown_delivery_open_count,
          },
          {
            labels: 'state="provider_conflict"',
            value: signals.provider_conflict_open_count,
          },
        ],
      ),
    );
    add(
      metricFamily(
        "evo_platform_private_media_items",
        "Current private media archive items by state.",
        [
          { labels: 'state="pending"', value: signals.private_media_pending_count },
          {
            labels: 'state="processing"',
            value: signals.private_media_processing_count,
          },
          {
            labels: 'state="retryable_error"',
            value: signals.private_media_retryable_error_count,
          },
          {
            labels: 'state="terminal_error"',
            value: signals.private_media_terminal_error_count,
          },
          {
            labels: 'state="expired_lease"',
            value: signals.private_media_expired_lease_count,
          },
        ],
      ),
    );
    add(
      metricFamily(
        "evo_platform_private_media_oldest_age_seconds",
        "Oldest unarchived private media item age in seconds.",
        signals.private_media_oldest_unarchived_age_seconds === null
          ? []
          : [{ value: signals.private_media_oldest_unarchived_age_seconds }],
      ),
    );
    add(
      metricFamily(
        "evo_platform_autonomy_items",
        "Current autonomous reply intents by latest lifecycle state.",
        [
          { labels: 'state="queued"', value: signals.autonomy_queued_count },
          {
            labels: 'state="dispatching"',
            value: signals.autonomy_dispatching_count,
          },
          { labels: 'state="unknown"', value: signals.autonomy_unknown_count },
          {
            labels: 'state="manual_review"',
            value: signals.autonomy_manual_review_count,
          },
        ],
      ),
    );
    add(
      metricFamily(
        "evo_platform_autonomy_oldest_queued_age_seconds",
        "Oldest queued autonomous reply intent age in seconds.",
        signals.autonomy_oldest_queued_age_seconds === null
          ? []
          : [{ value: signals.autonomy_oldest_queued_age_seconds }],
      ),
    );
    add(
      metricFamily(
        "evo_platform_autonomy_oldest_dispatching_age_seconds",
        "Oldest dispatching autonomous reply intent age in seconds.",
        signals.autonomy_oldest_dispatching_age_seconds === null
          ? []
          : [{ value: signals.autonomy_oldest_dispatching_age_seconds }],
      ),
    );
    add(
      metricFamily(
        "evo_platform_signal_saturated",
        "Whether any operational signal was clamped at its safe cap.",
        [{ value: signals.saturated ? 1 : 0 }],
      ),
    );
  }

  const warningCount = readiness.alerts.filter(
    ({ severity }) => severity === "warning",
  ).length;
  const criticalCount = readiness.alerts.filter(
    ({ severity }) => severity === "critical",
  ).length;
  add(
    metricFamily(
      "evo_platform_active_alerts",
      "Active deterministic operational alerts by severity.",
      [
        { labels: 'severity="warning"', value: warningCount },
        { labels: 'severity="critical"', value: criticalCount },
      ],
    ),
  );

  return `${lines.join("\n")}\n`;
}
