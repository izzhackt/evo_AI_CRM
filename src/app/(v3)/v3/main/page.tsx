import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense, type ComponentProps } from "react";

import type { PeriodChoice } from "@/components/v3/MainHeader";
import { PartShell } from "@/components/v3/PartShell";
import { SalesCallsReport } from "@/components/v3/SalesCallsReport";
import { SalesDynamics } from "@/components/v3/SalesDynamics";
import { SalesManagerLabelsView } from "@/components/v3/SalesManagerLabelsView";
import { SalesRegisterImportView } from "@/components/v3/SalesRegisterImportView";
import { SalesDynamicsReport, SalesRegisterView, type SalesReportQuery } from "@/components/v3/SalesRegisterView";
import { TodayBoardLinks, TodayScreen } from "@/components/v3/today/TodayScreen";
import { isStaffPreview, staffCan, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isSalesImportQuery, isSalesManagersQuery, SALES_CALLS_ANCHOR, SALES_DYNAMICS_ANCHOR, salesDynamicsCarry, salesDynamicsHref } from "@/lib/sales-register-navigation";
import { PERIODS, periodLabel, resolvePeriod } from "@/lib/v3/funnel-source";
import { v3SectionTitle } from "@/lib/v3/navigation";
import { readSalesDynamics, type SalesDynamicsRead } from "@/lib/v3/sales-dynamics-source";
import type { TelephonyReportState } from "@/lib/v3/telephony-report";
import { canReadTelephonyReport, readTelephonyReport } from "@/lib/v3/telephony-report-source";
import { buildTodayQueue, todayDateLabel } from "@/lib/v3/today-queue";
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
  return { title: v3SectionTitle("/v3/main", await searchParams) };
}

type MainQuery = Readonly<{ period?: string; from?: string; to?: string; view?: string } & SalesReportQuery>;

/** Раздел отчёта ждёт уже начатые чтения (они не отказывают: ошибки — внутри результата). */
async function StreamedSalesDynamics({ read, ...props }: Omit<ComponentProps<typeof SalesDynamics>, "read"> & Readonly<{ read: Promise<SalesDynamicsRead> }>) {
  return <SalesDynamics {...props} read={await read} />;
}

/** Блок «Звонки» ждёт уже начатое чтение (оно не отказывает: ошибки — внутри результата). */
async function StreamedSalesCalls({ read, ...props }: Omit<ComponentProps<typeof SalesCallsReport>, "state"> & Readonly<{ read: Promise<TelephonyReportState> }>) {
  return <SalesCallsReport {...props} state={await read} />;
}

/**
 * `/v3/main` — «Сегодня» (Э3, 26.09.2026): стартовая страница каждой роли с
 * одной очередью того, что пора сделать. Графики, период и воронка — в
 * разделе «Динамика по дням» «Отчёта продаж» (`?view=sales`). Роль, которая
 * читает лиды, но не записи отчёта (Admissions по миграции 173: `lead.read`
 * без `sales.register.read`), видела их на прежней Главной — у неё «Отчёт
 * продаж» состоит из одного этого раздела.
 */
export default async function MainPart({
  searchParams,
}: {
  searchParams: Promise<MainQuery>;
}) {
  const actor = await requireV3PageActor("/v3/main");
  const query = await searchParams;
  const canReadSales = staffPresentationCan(actor, "sales.read");
  const canReadReport = isStaffPreview(actor) ? canReadSales : staffCan(actor, "sales.report.read");

  if (query.view === "sales") {
    if (!canReadReport && !canReadSales) redirect("/access-denied?from=%2Fv3%2Fmain");
    if (canReadReport && isSalesImportQuery(query)) return <SalesRegisterImportView actor={actor} query={query} />;
    // «Менеджеры в отчёте» (Э8.6): право проверяют чтение и сервер (перенос данных отчёта).
    if (canReadReport && isSalesManagersQuery(query)) return <SalesManagerLabelsView actor={actor} query={query} />;
    if (!canReadSales) return <SalesRegisterView actor={actor} query={query} />;
    const period = resolvePeriod(query);
    const carry = salesDynamicsCarry(query);
    // «Период», когда он уже выбран, несёт разобранные даты: в адресе — тот
    // диапазон, который посчитан, а не набранный руками.
    const choices: PeriodChoice[] = PERIODS.map((one) => ({
      key: one.key,
      title: one.title,
      href: salesDynamicsHref(query, one.key === "custom" && period.key === "custom" ? period : { key: one.key }),
      active: one.key === period.key,
    }));
    // Чтения раздела идут параллельно с отчётом, а раздел приходит потоком:
    // записи отчёта не ждут когорту и доску. Без записей отчёта раздел — вся
    // страница: открыт всегда.
    const dynamics = readSalesDynamics(actor, period);
    const dynamicsSection = (
      <Suspense fallback={<p role="status" className="mt-8 flex min-h-11 items-center border-t border-border pt-2 t-meta text-fg-3">Загружаем «Динамику по дням»…</p>}>
        <StreamedSalesDynamics
          id={SALES_DYNAMICS_ANCHOR}
          open={!canReadReport || typeof query.period === "string"}
          choices={choices}
          range={period.key === "custom" ? { from: period.from, to: period.to, max: period.today } : null}
          periodText={periodLabel(period)}
          formAction={`/v3/main#${SALES_DYNAMICS_ANCHOR}`}
          carry={carry}
          retryHref={salesDynamicsHref(query, period)}
          read={dynamics}
        />
      </Suspense>
    );
    // Блок «Звонки» («Телефония Beeline KG», срез T10) — под «Динамикой по дням», с тем же периодом.
    // Право и включатель `ui_enabled` решает база; пока он выключен, блока нет вовсе. Пока читается,
    // на его месте пусто: людям, у которых телефония выключена, нечего показывать «Загружаем…».
    const callsSection = canReadTelephonyReport(actor) ? (
      <Suspense fallback={null}>
        <StreamedSalesCalls
          id={SALES_CALLS_ANCHOR}
          open={typeof query.period === "string"}
          choices={choices.map((one) => ({
            ...one,
            href: salesDynamicsHref(query, one.key === "custom" && period.key === "custom" ? period : { key: one.key }, SALES_CALLS_ANCHOR),
          }))}
          range={period.key === "custom" ? { from: period.from, to: period.to, max: period.today } : null}
          periodText={periodLabel(period)}
          formAction={`/v3/main#${SALES_CALLS_ANCHOR}`}
          carry={carry}
          retryHref={salesDynamicsHref(query, period, SALES_CALLS_ANCHOR)}
          read={readTelephonyReport(actor, { from: period.from, to: period.to })}
        />
      </Suspense>
    ) : null;
    const section = <>{dynamicsSection}{callsSection}</>;
    if (!canReadReport) return <SalesDynamicsReport dynamics={section} />;
    return <SalesRegisterView actor={actor} query={query} dynamics={section} />;
  }

  const now = new Date();
  // «Позвонить» (Телефония, T7) читается рядом с очередью: сбой или выключенный набор — просто без кнопок.
  const [{ access, reads }, dial] = await Promise.all([readTodayQueue(actor, { now }), readDialOptions(actor)]);
  const queue = buildTodayQueue(reads, now);
  // Задача «Перезвонить клиенту» несёт лид: строка называет клиента, пока набор открыт этому сотруднику (иначе — как раньше).
  const taskLeads = dial.status === "ready" ? await readTodayTaskLeads(actor, queue) : null;
  const preview = isStaffPreview(actor);
  const { boards, mainAction } = todayLinks(actor, access, { canReadReport });

  return (
    <PartShell
      title="Сегодня"
      testId="v3-operational-dashboard"
      meta={<time dateTime={queue.today}>{todayDateLabel(queue.today)}</time>}
      action={<TodayBoardLinks links={boards} />}
    >
      <TodayScreen
        queue={queue}
        nowIso={now.toISOString()}
        mainAction={mainAction}
        dial={dial}
        taskLeads={taskLeads}
        permissions={{
          actorMembershipId: actor.membershipId,
          admin: actor.systemRole === "admin" && !preview,
          preview,
          staffComplete: staffHasPermission(actor, "staff.task.complete"),
          staffEdit: staffHasPermission(actor, "staff.task.edit"),
          caseManage: staffHasPermission(actor, "task.manage"),
          caseAssign: staffHasPermission(actor, "task.assign"),
        }}
      />
    </PartShell>
  );
}
