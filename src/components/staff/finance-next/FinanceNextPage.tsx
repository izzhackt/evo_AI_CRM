"use client";

import { EmptyState, PageShell } from "@/components/kit";
import { LookerReportNext } from "@/components/staff/reports-next/LookerReportNext";
import type { ReportLinkRead } from "@/lib/report-link-contract";
import type { StudentDebtsRead } from "@/lib/student-debts-contract";

import { StudentDebtsNext } from "./StudentDebtsNext";

/**
 * «Финансы» в новом виде: рамка страницы с вкладками и одна из финансовых вкладок — «Финансовый отчёт» (Looker Studio) или «Долги
 * студентов». «Отчёт продаж» рисует своя вкладка (`SalesTabView`) в той же рамке. Чтение, право «Админы + бухгалтер» и слова те же:
 * нет права на всю организацию — «Нет доступа» без окна и адреса отчёта. Откуда цифры — строка под заголовком, видимая: отчёт может
 * не совпасть с «Отчётом продаж», и это нельзя прятать за «?».
 */
export function FinanceNextPage({ tabs, current, finance, debts, isAdmin, source, adminNote }: Readonly<{
  /** Ряд вкладок (сервер собирает его по правам); пустой — нет ни одной вкладки, «Нет доступа». */
  tabs: React.ReactNode;
  current: "finance" | "debts" | null;
  finance: ReportLinkRead | null;
  debts: StudentDebtsRead | null;
  isAdmin: boolean;
  source: string;
  adminNote: string | null;
}>) {
  return (
    <PageShell title="Финансы" testId="v3-finance" meta={current === "finance" ? source : undefined} tabs={tabs}>
      {current === "finance" && finance && finance.status !== "denied" ? (
        <LookerReportNext reportKey="finance" read={finance} canManage={isAdmin} retryHref="/finance?tab=finance" adminNote={adminNote ?? undefined} />
      ) : current === "debts" && debts ? (
        <StudentDebtsNext read={debts} />
      ) : (
        <div className="rounded-card border border-border bg-surface" data-testid="v3-finance-denied">
          <EmptyState title="Нет доступа к странице «Финансы»: нужно право на «Отчёт продаж» или «Полный просмотр финансов» на всю организацию." />
        </div>
      )}
    </PageShell>
  );
}
