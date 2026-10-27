"use client";

import { EmptyState, PageShell } from "@/components/kit";
import { LookerReportNext } from "@/components/v3/reports-next/LookerReportNext";
import type { ReportLinkRead } from "@/lib/report-link-contract";

/**
 * «Финансы» в новом виде: рамка страницы и отчёт Looker Studio. Чтение, право «Админы + бухгалтер» и слова те же, что у прежнего
 * вида (`/v3/finance/page.tsx`): нет права на всю организацию — «Нет доступа» без окна и адреса отчёта. Откуда цифры — строка
 * под заголовком, видимая: отчёт может не совпасть с «Отчётом продаж», и это нельзя прятать за «?».
 */
export function FinanceNextPage({ read, isAdmin, source, adminNote }: Readonly<{
  read: ReportLinkRead;
  isAdmin: boolean;
  source: string;
  adminNote: string | null;
}>) {
  return (
    <PageShell title="Финансы" testId="v3-finance" meta={source}>
      {read.status === "denied" ? (
        <div className="rounded-card border border-border bg-surface" data-testid="v3-finance-denied">
          <EmptyState title="Нет доступа к отчёту «Финансы»: нужно право «Полный просмотр финансов» на всю организацию." />
        </div>
      ) : (
        <LookerReportNext reportKey="finance" read={read} canManage={isAdmin} retryHref="/v3/finance" adminNote={adminNote ?? undefined} />
      )}
    </PageShell>
  );
}
