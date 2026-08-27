import Link from "next/link";

import {
  Card,
  EmptyState,
  PageHeader,
  btnCls,
  btnGhostCls,
} from "@/components/ui";
import { isPlatformP7AAuditEnabled } from "@/lib/platform-audit-config";
import { requirePlatformOperationsAdminActor } from "@/lib/platform-guards";
import type {
  PlatformComponentStatus,
  PlatformRestoreComponent,
} from "@/lib/platform-observability";
import { loadPlatformOperationsReadiness } from "@/lib/server/platform-operations-readiness";

const STATUS_LABELS: Record<PlatformComponentStatus, string> = {
  ready: "Готово",
  failed: "Ошибка",
  unavailable: "Недоступно",
  missing: "Нет данных",
  unverified: "Не проверено у провайдера",
  stale: "Данные устарели",
};

const RESTORE_STATUS_LABELS: Record<
  PlatformRestoreComponent["status"],
  string
> = {
  ready: "Восстановление проверено",
  failed: "Проверка восстановления не пройдена",
  missing: "Нет доказательства восстановления",
};

function statusClass(status: PlatformComponentStatus | PlatformRestoreComponent["status"]) {
  if (status === "ready") return "border-success/30 bg-success-weak text-success";
  if (status === "failed" || status === "unavailable") {
    return "border-danger/30 bg-danger-weak text-danger";
  }
  return "border-warning/30 bg-warning-weak text-warning";
}

function ageLabel(ageSeconds: number | null): string {
  if (ageSeconds === null) return "Возраст данных неизвестен";
  if (ageSeconds < 60) return `${ageSeconds} сек. назад`;
  if (ageSeconds < 3_600) return `${Math.floor(ageSeconds / 60)} мин. назад`;
  return `${Math.floor(ageSeconds / 3_600)} ч. назад`;
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-ctl border border-border bg-surface-2 px-3 py-2.5">
      <dt className="text-[11px] leading-4 text-fg-3">{label}</dt>
      <dd className="mt-1 text-[18px] font-bold tabular-nums text-fg">{value}</dd>
    </div>
  );
}

export default async function PlatformOperationsSettingsPage() {
  await requirePlatformOperationsAdminActor();
  const readiness = await loadPlatformOperationsReadiness();
  const auditEnabled = isPlatformP7AAuditEnabled();
  const requiredComponents = [
    ["Supabase и безопасная проекция", readiness.components.supabase],
    ["Неизменяемый аудит", readiness.components.audit_append],
    ["WhatsApp / WAHA", readiness.components.waha],
    ["AI-помощник", readiness.components.ai],
  ] as const;
  const recoveryComponents = [
    ["База данных", readiness.components.restore_database],
    ["Приватные файлы Storage", readiness.components.restore_storage],
  ] as const;

  return (
    <div className="grid gap-5" data-testid="platform-operations-settings">
      <PageHeader
        title="Операционная готовность"
        description="Фактическое состояние критичных служб, очередей и восстановления EVO Platform."
      />
      <nav aria-label="Разделы настроек" className="flex flex-wrap gap-2">
        <Link className={btnGhostCls} href="/settings?tab=staff">
          Доступ сотрудников
        </Link>
        {auditEnabled ? (
          <Link className={btnGhostCls} href="/settings?tab=audit">
            Журнал аудита
          </Link>
        ) : null}
        <span aria-current="page" className={btnCls}>Операции</span>
      </nav>
      <div data-testid="platform-readiness-summary">
        <Card>
          <div aria-live="polite" data-status={readiness.status}>
            <p
              className={
                readiness.ok
                  ? "text-[16px] font-bold text-success"
                  : "text-[16px] font-bold text-danger"
              }
            >
              {readiness.ok
                ? "Основные рабочие службы готовы"
                : "Платформа не готова к работе"}
            </p>
            <p className="mt-1 text-[12px] leading-5 text-fg-3">
              Наблюдение: <time dateTime={readiness.observed_at}>{readiness.observed_at}</time>.
              Проверка восстановления показана отдельно и не скрывается за этим итогом.
            </p>
          </div>
        </Card>
      </div>

      <Card title="Критичные компоненты">
        <ul className="grid gap-2 md:grid-cols-2">
          {requiredComponents.map(([label, component]) => (
            <li
              className="rounded-ctl border border-border px-3 py-3"
              data-status={component.status}
              key={label}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-fg">{label}</span>
                <span
                  className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClass(component.status)}`}
                >
                  {STATUS_LABELS[component.status]}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-fg-3">{ageLabel(component.age_seconds)}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Блокеры и инструкции">
        {readiness.alerts.length === 0 ? (
          <EmptyState text="Активных блокеров нет." />
        ) : (
          <ul className="grid gap-2">
            {readiness.alerts.map((alert) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 rounded-ctl border border-border px-3 py-2.5"
                data-severity={alert.severity}
                key={alert.code}
              >
                <div>
                  <p className="font-mono text-[12px] font-semibold text-fg">{alert.code}</p>
                  <p className="mt-0.5 text-[11px] text-fg-3">
                    Ответственный контур: {alert.owner_category}
                  </p>
                </div>
                <code className="rounded bg-surface-2 px-2 py-1 text-[11px] text-fg-2">
                  {alert.runbook_id}
                </code>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Восстановление из резервной копии">
        <p className="mb-3 text-[12px] leading-5 text-fg-3">
          Наличие файла резервной копии ещё не доказывает восстановление. База и
          приватные файлы проверяются независимо в отдельной непроизводственной среде.
        </p>
        <ul className="grid gap-2 md:grid-cols-2">
          {recoveryComponents.map(([label, component]) => (
            <li
              className="rounded-ctl border border-border px-3 py-3"
              data-status={component.status}
              key={label}
            >
              <p className="text-[13px] font-semibold text-fg">{label}</p>
              <p
                className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] font-semibold ${statusClass(component.status)}`}
              >
                {RESTORE_STATUS_LABELS[component.status]}
              </p>
              <p className="mt-1 text-[11px] text-fg-3">{ageLabel(component.age_seconds)}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Безопасные агрегированные показатели по всей платформе">
        {readiness.signals ? (
          <div>
            <p className="mb-3 text-[12px] leading-5 text-fg-3">
              Это ограниченные общие счётчики без клиентов, телефонов, документов
              и других идентификаторов. Наблюдение: {" "}
              <time dateTime={readiness.signals.observed_at}>
                {readiness.signals.observed_at}
              </time>.
            </p>
            {readiness.signals.saturated ? (
              <p
                className="mb-3 rounded-ctl border border-danger/30 bg-danger-weak px-3 py-2 text-[12px] font-semibold text-danger"
                data-testid="platform-counts-partial"
              >
                Показатели частичные: источник достиг безопасного лимита выборки.
              </p>
            ) : null}
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Count label="Очередь: готово" value={readiness.signals.queue_ready_count} />
              <Count label="Очередь: повтор" value={readiness.signals.queue_retry_wait_count} />
              <Count label="Просроченные аренды" value={readiness.signals.queue_expired_lease_count} />
              <Count label="Dead letter" value={readiness.signals.dead_letter_count} />
              <Count label="Медиа ожидает" value={readiness.signals.private_media_pending_count} />
              <Count label="Медиа обрабатывается" value={readiness.signals.private_media_processing_count} />
              <Count label="AI ожидает" value={readiness.signals.autonomy_queued_count} />
              <Count label="Нужна ручная проверка" value={readiness.signals.autonomy_manual_review_count} />
            </dl>
          </div>
        ) : (
          <EmptyState text="Безопасные операционные показатели недоступны; состояние не считается готовым." />
        )}
      </Card>
    </div>
  );
}
