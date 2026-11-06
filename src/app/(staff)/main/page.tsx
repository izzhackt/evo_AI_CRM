import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SalesTabView } from "@/components/staff/sales-next/SalesTabView";
import { TodayNextLazy } from "@/components/staff/today-next/TodayNextLazy";
import { isStaffPreview, staffCan, staffCanSalesTab, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { salesReportRedirectHref } from "@/lib/sales-register-navigation";
import { v3SectionTitle } from "@/lib/v3/navigation";
import { buildTodayQueue } from "@/lib/v3/today-queue";
import { readDialOptions } from "@/lib/v3/telephony-dial-source";
import { readTodayTaskLeads } from "@/lib/v3/telephony-task-leads-source";
import { readTodayQueue, todayLinks } from "@/lib/v3/today-source";

export const dynamic = "force-dynamic";

/** Вкладка называет подсвеченный пункт меню: «Сегодня» или «Отчёт продаж». */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  return { title: v3SectionTitle("/main", await searchParams) };
}

type MainQuery = Readonly<Record<string, string | undefined>>;

/**
 * `/main` — «Сегодня» (Э3, 26.09.2026): стартовая страница каждой роли с
 * одной очередью того, что пора сделать. Графики, период и воронка — в
 * разделе «Динамика по дням» «Отчёта продаж» (`/finance?tab=sales` для читателей записей, у роли без записей — `/main?view=sales`). Роль, которая
 * читает лиды, но не записи отчёта (Admissions по миграции 173: `lead.read`
 * без `sales.register.read`), видела их на прежней Главной — у неё «Отчёт
 * продаж» состоит из одного этого раздела.
 */
export default async function MainPart({
  searchParams,
}: {
  searchParams: Promise<MainQuery>;
}) {
  const actor = await requireV3PageActor("/main");
  const query = await searchParams;
  const canReadSales = staffPresentationCan(actor, "sales.read");
  const canReadReport = isStaffPreview(actor) ? canReadSales : staffCan(actor, "sales.report.read");

  // «Отчёт продаж» переехал во вкладку «Финансов» (решение владельца 06.11.2026): прежний адрес ведёт туда с теми же параметрами.
  // Роль без права на записи отчёта (поступление с `lead.read`) во «Финансы» не идёт: её «Динамика по дням» и «Звонки» остались здесь.
  if (query.view === "sales" && staffCanSalesTab(actor)) redirect(salesReportRedirectHref(query));
  if (query.view === "sales" && canReadSales) return <SalesTabView actor={actor} query={query} home="today" />;

  const now = new Date();
  // «Позвонить» (Телефония, T7) читается рядом с очередью: сбой или выключенный набор — просто без кнопок.
  // Набор открыт этому сотруднику — значит, вкладка «Звонки» в «Заявках» точно читается: звонок с неизвестного номера открывает её.
  // Это лишь часть случаев: вкладке хватает включённого интерфейса телефонии, а набору ещё нужны право звонить и отсутствие паузы,
  // поэтому у сотрудника без набора звонок открывается, как раньше, в панели доски (там нет «Взять себе»).
  const dialRead = readDialOptions(actor);
  const [{ access, reads }, dial] = await Promise.all([
    readTodayQueue(actor, { now, callsTab: dialRead.then((options) => options.status === "ready") }),
    dialRead,
  ]);
  const queue = buildTodayQueue(reads, now);
  // Задача «Перезвонить клиенту» несёт лид: строка называет клиента, пока набор открыт этому сотруднику (иначе — как раньше).
  const taskLeads = dial.status === "ready" ? await readTodayTaskLeads(actor, queue) : null;
  const preview = isStaffPreview(actor);
  const { mainAction } = todayLinks(actor, access, { canReadReport });
  const permissions = {
    actorMembershipId: actor.membershipId,
    admin: actor.systemRole === "admin" && !preview,
    preview,
    staffComplete: staffHasPermission(actor, "staff.task.complete"),
    staffEdit: staffHasPermission(actor, "staff.task.edit"),
    caseManage: staffHasPermission(actor, "task.manage"),
    caseAssign: staffHasPermission(actor, "task.assign"),
  };

  // «Новый вид» (единственный вид, #1327): виджеты вместо ленты.
  return <TodayNextLazy queue={queue} nowIso={now.toISOString()} mainAction={mainAction} dial={dial} taskLeads={taskLeads} permissions={permissions} />;
}
