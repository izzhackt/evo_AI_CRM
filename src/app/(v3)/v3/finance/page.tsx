import { EmptyState } from "@/components/ui";
import { PartShell } from "@/components/v3/PartShell";
import { LookerReport } from "@/components/v3/reports/LookerReport";
import { requireV3PageActor } from "@/lib/platform-guards";
import { readReportLink } from "@/lib/v3/report-links-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Финансы" };

/**
 * «Финансы» (решения владельца 26.10.2026: «Админы + бухгалтер», отчёт Looker Studio из Google Таблицы финансиста;
 * миграция 323). Страницу открывают настоящий администратор и держатель «Полного просмотра финансов»; просмотр роли и
 * остальных `requireV3PageActor` отправляет на «Нет доступа». Право на ВСЮ организацию проверяет база при чтении ссылки:
 * держатель права только на «свои» дела, направление, отдел или запись видит «Нет доступа к отчёту» — без окна и без
 * адреса отчёта. Цифры отчёта — из таблицы финансиста, а не из CRM: страница ничего не считает и не придумывает, а
 * источник назван. Место под собственные блоки CRM осталось: отчёт — первый раздел страницы, не вся страница.
 */
export default async function FinancePage() {
  const actor = await requireV3PageActor("/v3/finance");
  const read = await readReportLink(actor, "finance");
  const isAdmin = actor.systemRole === "admin";
  return (
    <PartShell title="Финансы" testId="v3-finance">
      {read.status === "denied" ? (
        <div className="rounded-card border border-border bg-surface" data-testid="v3-finance-denied">
          <EmptyState text="Нет доступа к отчёту «Финансы»: нужно право «Полный просмотр финансов» на всю организацию." />
        </div>
      ) : (
        <LookerReport
          reportKey="finance"
          read={read}
          source="Цифры — из Google Таблицы финансиста, а не из CRM. Они могут не совпадать с «Отчётом продаж» и вкладкой «Договор и оплата»."
          canManage={isAdmin}
          retryHref="/v3/finance"
          adminNote={isAdmin ? "Отчёт открывает Google, а не CRM. Снятие роли в CRM не закрывает отчёт: когда человек уходит, уберите его в «Поделиться» отчёта и таблицы." : undefined}
        />
      )}
    </PartShell>
  );
}
