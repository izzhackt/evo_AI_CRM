import { CircleCheckIcon, CircleIcon, AlertTriangleIcon } from "lucide-react";
import Link from "next/link";

import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { ReportLinkForm } from "@/components/v3/settings/ReportLinkForm";
import { formatBishkekMoment } from "@/lib/marketing-view";
import { REPORT_KEYS, REPORT_SECTION_HREF, REPORT_TITLE, type ReportKey, type ReportLinkRead } from "@/lib/report-link-contract";

const RETRY_HREF = "/v3/settings?section=reports";

/** Состояние словом со знаком: «Подключён · изменён …», «Не подключён» или «Не удалось прочитать настройку отчёта.». */
function StateLine({ read }: Readonly<{ read: ReportLinkRead }>) {
  const [Icon, tone, text] = read.status !== "available"
    ? [AlertTriangleIcon, "text-warn", "Не удалось прочитать настройку отчёта."] as const
    : read.link.configured
      ? [CircleCheckIcon, "text-ok", `Подключён${read.link.updatedAt ? ` · изменён ${formatBishkekMoment(read.link.updatedAt)}` : ""}`] as const
      : [CircleIcon, "text-fg-3", "Не подключён"] as const;
  return <p className="flex items-start gap-1.5 t-body-compact text-fg"><Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${tone}`} /><span>{text}</span></p>;
}

/**
 * «Отчёты»: две ссылки организации — на отчёты Looker Studio для «Маркетинга» и «Финансов». Строка состояния, поле «Код или ссылка»
 * и кнопки — прежняя форма (`ReportLinkForm`: те же поля, действия и request_id, которые теперь выдаёт сервер страницы). В просмотре
 * роли — только строки состояния. Идентификаторов отчёта в разделе нет. Примечание о доступе в Google одно на обе карточки.
 */
export function ReportsNext({ reads, readOnly, ids }: Readonly<{
  reads: Readonly<Record<ReportKey, ReportLinkRead>>;
  readOnly: boolean;
  ids: Readonly<Record<ReportKey, Readonly<{ save: string; remove: string }>>>;
}>) {
  return (
    <div className="grid min-w-0 gap-4" data-testid="v3-settings-reports">
      {REPORT_KEYS.map((key) => {
        const read = reads[key];
        const connected = read.status === "available" && read.link.configured;
        return (
          <WidgetCard
        headingLevel={3}
            key={key}
            title={REPORT_TITLE[key]}
            actions={connected && !readOnly ? <Button variant="ghost" asChild><Link href={REPORT_SECTION_HREF[key]}>Открыть раздел</Link></Button> : undefined}
            bodyClassName="grid gap-4"
          >
            <div className="grid gap-4" data-testid={`v3-report-card-${key}`}>
              <StateLine read={read} />
              {readOnly ? null : read.status === "available"
                ? <ReportLinkForm reportKey={key} version={read.link.version} connected={connected} requestId={ids[key].save} removeRequestId={ids[key].remove} />
                : <div><Button variant="outline" asChild><a href={RETRY_HREF}>Обновить</a></Button></div>}
            </div>
          </WidgetCard>
        );
      })}
      <p className="t-meta text-fg-3" data-testid="v3-settings-reports-note">
        {readOnly
          ? "В режиме просмотра роли ссылки не меняются."
          : "CRM не видит настройки доступа в Google. Отчёт должен быть открыт только нужным людям: проверьте ссылку в окне инкогнито — она должна просить вход. Снятие роли в CRM не закрывает отчёт в Google: когда человек уходит, сначала уберите его в «Поделиться» отчёта и таблицы."}
      </p>
    </div>
  );
}
