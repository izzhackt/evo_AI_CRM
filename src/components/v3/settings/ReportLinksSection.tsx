import { randomUUID } from "node:crypto";

import Link from "next/link";

import { Icon } from "@/components/icons";
import { formatBishkekMoment } from "@/lib/marketing-view";
import {
  REPORT_KEYS, REPORT_SECTION_HREF, REPORT_TITLE,
  type ReportKey, type ReportLinkRead,
} from "@/lib/report-link-contract";
import { ReportLinkForm } from "./ReportLinkForm";
import { Card } from "./sections";

/** Куда ведёт «Обновить», когда настройку не удалось прочитать. */
const RETRY_HREF = "/v3/settings?section=reports";

/**
 * «Настройки → Отчёты» (миграция 323; план отчётов Looker §7.1): две ссылки организации — отчёт «Маркетинга» и отчёт
 * «Финансов». Строка состояния словом («Подключён · изменён …» / «Не подключён»), под ней поле и кнопки. В просмотре
 * роли виден только статус: ни поля, ни кнопок, ни идентификаторов, и действия там отказывают сами (до вызова базы).
 * Идентификаторы отчёта в этом разделе не выводятся вовсе: CRM держит их, а показывает только окно отчёта тем, кому
 * открыт раздел.
 */
function StateLine({ read }: Readonly<{ read: ReportLinkRead }>) {
  if (read.status !== "available") {
    return (
      <p className="flex items-start gap-1.5 t-body-compact text-fg">
        <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warn" />
        <span>Не удалось прочитать настройку отчёта.</span>
      </p>
    );
  }
  const { link } = read;
  return link.configured ? (
    <p className="flex items-start gap-1.5 t-body-compact text-fg">
      <Icon name="circle-check" size={16} className="mt-0.5 shrink-0 text-ok" />
      <span>Подключён{link.updatedAt ? ` · изменён ${formatBishkekMoment(link.updatedAt)}` : ""}</span>
    </p>
  ) : (
    <p className="flex items-start gap-1.5 t-body-compact text-fg">
      <Icon name="circle" size={16} className="mt-0.5 shrink-0 text-fg-3" />
      <span>Не подключён</span>
    </p>
  );
}

function ReportCard({ reportKey, read, readOnly }: Readonly<{ reportKey: ReportKey; read: ReportLinkRead; readOnly: boolean }>) {
  const connected = read.status === "available" && read.link.configured;
  return (
    <Card
      title={REPORT_TITLE[reportKey]}
      aside={connected && !readOnly ? (
        <Link href={REPORT_SECTION_HREF[reportKey]} className="inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4 hover:text-fg-2 sm:-my-2.5">
          Открыть раздел
        </Link>
      ) : undefined}
    >
      <div className="space-y-4 px-4 py-4" data-testid={`v3-report-card-${reportKey}`}>
        <StateLine read={read} />
        {readOnly ? null : read.status === "available" ? (
          <ReportLinkForm reportKey={reportKey} version={read.link.version} connected={connected} requestId={randomUUID()} removeRequestId={randomUUID()} />
        ) : (
          <a href={RETRY_HREF} className="inline-flex min-h-11 items-center t-label text-fg underline underline-offset-4 hover:text-fg-2">Обновить</a>
        )}
      </div>
    </Card>
  );
}

export function ReportLinksSection({ reads, readOnly }: Readonly<{ reads: Readonly<Record<ReportKey, ReportLinkRead>>; readOnly: boolean }>) {
  return (
    <div className="space-y-4" data-testid="v3-settings-reports">
      {REPORT_KEYS.map((key) => <ReportCard key={key} reportKey={key} read={reads[key]} readOnly={readOnly} />)}
      <p className="t-meta text-fg-3" data-testid="v3-settings-reports-note">
        {readOnly
          ? "В режиме просмотра роли ссылки не меняются."
          : "CRM не видит настройки доступа в Google. Отчёт должен быть открыт только нужным людям: проверьте ссылку в окне инкогнито — она должна просить вход. Снятие роли в CRM не закрывает отчёт в Google: когда человек уходит, сначала уберите его в «Поделиться» отчёта и таблицы."}
      </p>
    </div>
  );
}
