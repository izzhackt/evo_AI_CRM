import Link from "next/link";

import { Icon } from "@/components/icons";
import { btnGhostCls, EmptyState } from "@/components/ui";
import { LookerFrame } from "@/components/v3/reports/LookerFrame";
import { lookerEmbedUrl, lookerOpenUrl } from "@/lib/looker-report-link";
import { REPORT_TITLE, type ReportKey, type ReportLinkRead } from "@/lib/report-link-contract";

/** Куда ведёт «Добавить ссылку»: раздел «Настройки → Отчёты». */
export const REPORT_SETTINGS_HREF = "/v3/settings?section=reports";

/**
 * Общий блок отчёта Looker Studio для «Маркетинг → Отчёты» и «Финансы» (план отчётов Looker §7.4): подпись источника,
 * шапка «Отчёт Looker Studio» с кнопкой «Открыть в новой вкладке», окно отчёта, подсказка о доступе. CRM не рисует цифр
 * сама: пока ссылки нет — честное пустое состояние, без нулей и примерных данных.
 *
 * Адрес окна собирается ЗДЕСЬ по шаблону из идентификаторов (`lookerEmbedUrl`), что бы ни лежало в строке базы: если
 * идентификатор не годится, окна нет, а страница говорит, что настройку не удалось прочитать.
 */
export function LookerReport({
  reportKey, read, source, canManage, retryHref, adminNote,
}: Readonly<{
  reportKey: ReportKey;
  read: ReportLinkRead;
  /** Откуда цифры (одно предложение над блоком): каждый источник называется. */
  source: string;
  /** Админ видит «Добавить ссылку»; бухгалтеру — «Ссылку добавляет администратор.» */
  canManage: boolean;
  /** Адрес этой же страницы для «Обновить». */
  retryHref: string;
  /** Напоминание только администратору (снятие роли в CRM не закрывает отчёт в Google). */
  adminNote?: string;
}>) {
  const link = read.status === "available" ? read.link : null;
  const embed = link?.reportId ? lookerEmbedUrl(link.reportId, link.pageId) : null;
  const open = link?.reportId ? lookerOpenUrl(link.reportId, link.pageId) : null;
  const title = REPORT_TITLE[reportKey];
  const frame = embed && open ? { embed, open } : null;

  return (
    <div className="space-y-3" data-testid={`v3-looker-report-${reportKey}`}>
      <p className="t-body-compact text-fg-2">{source}</p>
      <section aria-labelledby={`looker-report-${reportKey}`} className="overflow-hidden rounded-card border border-border bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2.5">
          <h2 id={`looker-report-${reportKey}`} className="t-section text-fg">Отчёт Looker Studio</h2>
          {frame ? (
            <a
              href={frame.open}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Открыть в новой вкладке: отчёт Looker Studio"
              className={`${btnGhostCls} max-md:hidden`}
            >
              Открыть в новой вкладке
              <Icon name="external-link" size={16} />
            </a>
          ) : null}
        </header>
        {frame ? (
          <>
            <LookerFrame src={frame.embed} title={`Отчёт Looker Studio: ${title}`} openUrl={frame.open} />
            <p className="t-meta border-t border-border bg-surface-2 px-4 py-2.5 text-fg-3">
              Отчёт виден только тем Google-аккаунтам, которым его открыли. Если вместо отчёта просьба войти или «нет доступа» — нажмите «Открыть в новой вкладке» и войдите в нужный аккаунт Google. В Safari и на iPhone отчёт обычно открывается только так.
            </p>
          </>
        ) : read.status === "available" && !link?.configured ? (
          <EmptyState
            title="Отчёт ещё не подключён."
            text={canManage ? "Ссылку на отчёт добавляют в «Настройки → Отчёты»." : "Ссылку добавляет администратор."}
            action={canManage ? <Link href={REPORT_SETTINGS_HREF} className={btnGhostCls}>Добавить ссылку</Link> : undefined}
          />
        ) : (
          <EmptyState
            text="Не удалось прочитать настройку отчёта."
            action={<a href={retryHref} className={btnGhostCls}><Icon name="refresh" size={16} />Обновить</a>}
          />
        )}
      </section>
      {adminNote && frame ? <p className="t-meta text-fg-3">{adminNote}</p> : null}
    </div>
  );
}
