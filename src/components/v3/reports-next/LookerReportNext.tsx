"use client";

import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";

import { EmptyState, WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { lookerEmbedUrl, lookerOpenUrl } from "@/lib/looker-report-link";
import { REPORT_TITLE, type ReportKey, type ReportLinkRead } from "@/lib/report-link-contract";

import { LookerFrameNext } from "./LookerFrameNext";

/** Куда ведёт «Добавить ссылку»: раздел «Настройки → Отчёты». */
const REPORT_SETTINGS_HREF = "/v3/settings?section=reports";

/**
 * Отчёт Looker Studio в «Новом виде» — один блок на «Маркетинг → Отчёты» и «Финансы». CRM цифр не рисует: окно отчёта Google,
 * кнопка «Открыть в новой вкладке» и строка о доступе (изнутри CRM не определить, что Google отказал окну, поэтому она
 * постоянная). Адрес окна по-прежнему собирается здесь из идентификаторов (`lookerEmbedUrl`), что бы ни лежало в строке базы.
 * Откуда цифры — строка страницы (`meta` шапки); нет ссылки или чтение не удалось — честное пустое состояние, без нулей.
 */
export function LookerReportNext({ reportKey, read, canManage, retryHref, adminNote }: Readonly<{
  reportKey: ReportKey;
  read: ReportLinkRead;
  canManage: boolean;
  /** Адрес этой же страницы для «Обновить». */
  retryHref: string;
  /** Напоминание только администратору: снятие роли в CRM не закрывает отчёт в Google. */
  adminNote?: string;
}>) {
  const link = read.status === "available" ? read.link : null;
  const embed = link?.reportId ? lookerEmbedUrl(link.reportId, link.pageId) : null;
  const open = link?.reportId ? lookerOpenUrl(link.reportId, link.pageId) : null;
  const frame = embed && open ? { embed, open } : null;
  return (
    <div className="grid min-w-0 gap-3" data-testid={`v3-looker-report-${reportKey}`}>
      <WidgetCard
        title="Отчёт Looker Studio"
        help="Отчёт открывает Google, а не CRM. В Safari и на iPhone он обычно открывается только в новой вкладке."
        bodyClassName="p-0"
        actions={frame ? (
          <Button variant="outline" asChild className="max-md:hidden">
            <a href={frame.open} target="_blank" rel="noopener noreferrer" aria-label="Открыть в новой вкладке: отчёт Looker Studio">
              Открыть в новой вкладке
              <ExternalLinkIcon aria-hidden="true" />
            </a>
          </Button>
        ) : undefined}
        footer={frame ? (
          <p className="t-meta text-fg-3">
            Отчёт виден только тем Google-аккаунтам, которым его открыли. Просит вход или «нет доступа» — откройте его в новой вкладке под нужным аккаунтом.
          </p>
        ) : undefined}
      >
        {frame ? (
          <LookerFrameNext src={frame.embed} title={`Отчёт Looker Studio: ${REPORT_TITLE[reportKey]}`} openUrl={frame.open} />
        ) : read.status === "available" && !link?.configured ? (
          <EmptyState
            title="Отчёт ещё не подключён."
            description={canManage ? "Ссылку на отчёт добавляют в «Настройки → Отчёты»." : "Ссылку добавляет администратор."}
            action={canManage ? <Button variant="outline" asChild><Link href={REPORT_SETTINGS_HREF}>Добавить ссылку</Link></Button> : undefined}
          />
        ) : (
          <EmptyState
            tone="danger"
            title="Не удалось прочитать настройку отчёта."
            action={<Button variant="outline" asChild><a href={retryHref}><RefreshCwIcon aria-hidden="true" />Обновить</a></Button>}
          />
        )}
      </WidgetCard>
      {adminNote && frame ? <p className="t-meta text-fg-3">{adminNote}</p> : null}
    </div>
  );
}
