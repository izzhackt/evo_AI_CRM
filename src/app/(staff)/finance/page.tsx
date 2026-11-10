import { FinanceNextLazy } from "@/components/staff/finance-next/FinanceNextLazy";
import { FinanceTabs, type FinanceTabKey } from "@/components/staff/finance-next/FinanceTabs";
import { SalesTabView } from "@/components/staff/sales-next/SalesTabView";
import { staffCanFinanceTabHint, staffCanSalesTab } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import type { ReportLinkRead } from "@/lib/report-link-contract";
import { readReportLink } from "@/lib/v3/report-links-source";
import { readStudentDebts } from "@/lib/v3/student-debts-source";
import { readStudentReceiptQueue } from "@/lib/v3/student-receipts-source";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";

export const dynamic = "force-dynamic";
export const metadata = { title: "Финансы" };

/**
 * «Финансы» (решения владельца 26.10.2026 и 06.11.2026): одна страница с вкладками «Отчёт продаж», «Финансовый отчёт» (Looker Studio из
 * Google Таблицы финансиста, миграция 323) и «Долги студентов» (миграция 332). Вкладки считает сервер по правам:
 *  - «Финансовый отчёт» и «Долги студентов» — только администратору и держателю «Полного просмотра финансов» на ВСЮ организацию; это
 *    проверяет база (`readReportLink`, `student_debts_v1`). Держатель права только на «свои» дела, направление, отдел или запись
 *    финансовых вкладок не получает;
 *  - «Отчёт продаж» видят и продажники (все записи — по области права `sales.register.read` в базе), администратор и бухгалтер.
 * Нет вкладки — нет и ссылки на неё: продажник не видит ни вкладки, ни адреса финансов, а `?tab=finance` у него открывает первую
 * доступную вкладку. Первая вкладка — вкладка по умолчанию. Просмотр роли и остальные уходят на «Нет доступа» (`requireV3PageActor`).
 * Прежний адрес `/main?view=sales` ведёт сюда переходом (`/finance?tab=sales`).
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireV3PageActor("/finance");
  const query = await searchParams;
  const finance: ReportLinkRead = staffCanFinanceTabHint(actor) ? await readReportLink(actor, "finance") : { status: "denied" };
  // «Чеки на проверке» (миграция 358): общая очередь для администратора и держателя полного чтения финансов; что видно и что можно
  // решить, считает база (чтение блока «Договор и оплата»). Бейдж - число чеков, ждущих решения.
  const receipts = staffCanFinanceTabHint(actor) ? await readStudentReceiptQueue(actor) : null;
  const keys: FinanceTabKey[] = [
    ...(staffCanSalesTab(actor) ? ["sales" as const] : []),
    ...(finance.status !== "denied" ? ["finance" as const, "debts" as const] : []),
    ...(receipts?.status === "ok" ? ["receipts" as const] : []),
  ];
  const requested = typeof query.tab === "string" ? query.tab : null;
  const current = keys.find((key) => key === requested) ?? keys[0] ?? null;
  const tabs = current ? <FinanceTabs tabs={keys} current={current} receiptsCount={receipts?.status === "ok" ? receipts.queue.total : null} /> : null;
  if (current === "sales") return <SalesTabView actor={actor} query={query} tabs={tabs} />;
  const isAdmin = actor.systemRole === "admin";
  const source = "Цифры — из Google Таблицы финансиста, а не из CRM. Они могут не совпадать с «Отчётом продаж» и вкладкой «Деньги».";
  const adminNote = "Отчёт открывает Google, а не CRM. Снятие роли в CRM не закрывает отчёт: когда человек уходит, уберите его в «Поделиться» отчёта и таблицы.";
  // «Новый вид» (единственный вид, #1327): отчёт в карточке набора; право на чтение решает база, «Нет доступа» рисует сам экран.
  return (
    <FinanceNextLazy tabs={tabs} current={current === "finance" || current === "debts" || current === "receipts" ? current : null}
      receipts={current === "receipts" && receipts?.status === "ok" ? receipts.queue : null} today={dayInOrganizationTimezone(new Date())} finance={current === "finance" ? finance : null}
      debts={current === "debts" ? await readStudentDebts(actor) : null} isAdmin={isAdmin} source={source} adminNote={isAdmin ? adminNote : null} />
  );
}
