import { FinanceNextLazy } from "@/components/staff/finance-next/FinanceNextLazy";
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
  const actor = await requireV3PageActor("/finance");
  const read = await readReportLink(actor, "finance");
  const isAdmin = actor.systemRole === "admin";
  const source = "Цифры — из Google Таблицы финансиста, а не из CRM. Они могут не совпадать с «Отчётом продаж» и вкладкой «Договор и оплата».";
  const adminNote = "Отчёт открывает Google, а не CRM. Снятие роли в CRM не закрывает отчёт: когда человек уходит, уберите его в «Поделиться» отчёта и таблицы.";
  // «Новый вид» (единственный вид, #1327): отчёт в карточке набора; право на чтение решает база, «Нет доступа» рисует сам экран.
  return <FinanceNextLazy read={read} isAdmin={isAdmin} source={source} adminNote={isAdmin ? adminNote : null} />;
}
