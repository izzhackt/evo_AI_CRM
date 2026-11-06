import { Suspense, type ComponentProps } from "react";

import type { PeriodChoice } from "@/components/staff/MainHeader";
import { SalesCallsReport } from "@/components/staff/SalesCallsReport";
import { SalesDynamics } from "@/components/staff/SalesDynamics";
import { isStaffPreview, staffCan, staffPresentationCan } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import {
  isSalesImportQuery, isSalesManagersQuery, SALES_CALLS_ANCHOR, SALES_DYNAMICS_ANCHOR, salesDynamicsCarry, salesDynamicsHref, type SalesDynamicsHome, type SalesReportQuery,
} from "@/lib/sales-register-navigation";
import { PERIODS, periodLabel, resolvePeriod } from "@/lib/v3/funnel-source";
import { readSalesDynamics, type SalesDynamicsRead } from "@/lib/v3/sales-dynamics-source";
import type { TelephonyReportState } from "@/lib/v3/telephony-report";
import { canReadTelephonyReport, readTelephonyReport } from "@/lib/v3/telephony-report-source";

import { SalesDynamicsNextView, SalesImportNextView, SalesManagersNextView } from "./SalesFramesNext";
import { SalesRegisterNextView } from "./SalesRegisterNextView";

/** Раздел отчёта ждёт уже начатые чтения (они не отказывают: ошибки — внутри результата). */
async function StreamedSalesDynamics({ read, ...props }: Omit<ComponentProps<typeof SalesDynamics>, "read"> & Readonly<{ read: Promise<SalesDynamicsRead> }>) {
  return <SalesDynamics {...props} read={await read} />;
}

/** Блок «Звонки» ждёт уже начатое чтение (оно не отказывает: ошибки — внутри результата). */
async function StreamedSalesCalls({ read, ...props }: Omit<ComponentProps<typeof SalesCallsReport>, "state"> & Readonly<{ read: Promise<TelephonyReportState> }>) {
  return <SalesCallsReport {...props} state={await read} />;
}

const FORM_ADDRESS = (home: SalesDynamicsHome) => (home === "today" ? "/main?view=sales" : "/finance?tab=sales");

/**
 * Вкладка «Отчёт продаж» страницы «Финансы» (решение владельца 06.11.2026; раньше — `/main?view=sales`). Чтения, права и порядок те
 * же: записи отчёта читает база по правам `sales.register.read` (видимость записей — область права роли: «свои», отдел или вся
 * организация), «Добавить продажу» открыта тому, кто может писать (`sales.register.manage`). Роль, которая читает лиды, но не
 * записи, видит «Динамику по дням» и «Звонки»; держатель финансов без права на лиды и записи — честное «нет доступа» от самой
 * вкладки, а не пустой отчёт. `tabs` — ряд вкладок страницы: под ним идёт содержимое; вложенные экраны («Перенос данных»,
 * «Менеджеры в отчёте», форма продажи) рисуются как отдельные страницы со своим возвратом.
 */
export async function SalesTabView({ actor, query, tabs, home = "finance" }: Readonly<{ actor: ActivePlatformActor; query: SalesReportQuery & Readonly<{ period?: string; from?: string; to?: string }>; tabs?: React.ReactNode; home?: SalesDynamicsHome }>) {
  const canReadSales = staffPresentationCan(actor, "sales.read");
  // `home="today"` — только «Динамика по дням» и «Звонки» для роли без записей отчёта (они остались под «Сегодня»), записей там нет никогда.
  const canReadReport = home === "today" ? false : isStaffPreview(actor) ? canReadSales : staffCan(actor, "sales.report.read");
  if (!canReadReport && !canReadSales) return <SalesDynamicsNextView dynamics={null} tabs={tabs} noAccess />;

  // «Новый вид» (единственный вид): плитки, таблица записей с панелью, карточки.
  if (canReadReport && isSalesImportQuery(query)) return <SalesImportNextView actor={actor} query={query} />;
  // «Менеджеры в отчёте» (Э8.6): право проверяют чтение и сервер (перенос данных отчёта).
  if (canReadReport && isSalesManagersQuery(query)) return <SalesManagersNextView actor={actor} query={query} />;
  if (!canReadSales) return <SalesRegisterNextView actor={actor} query={query} tabs={tabs} />;
  const period = resolvePeriod(query);
  const carry = salesDynamicsCarry(query, home);
  // «Период», когда он уже выбран, несёт разобранные даты: в адресе — тот диапазон, который посчитан, а не набранный руками.
  const choices: PeriodChoice[] = PERIODS.map((one) => ({
    key: one.key,
    title: one.title,
    href: salesDynamicsHref(query, one.key === "custom" && period.key === "custom" ? period : { key: one.key }, SALES_DYNAMICS_ANCHOR, home),
    active: one.key === period.key,
  }));
  // Чтения раздела идут параллельно с отчётом, а раздел приходит потоком: записи отчёта не ждут когорту и доску. Без записей
  // отчёта раздел — вся страница: открыт всегда.
  const dynamics = readSalesDynamics(actor, period);
  const dynamicsSection = (
    <Suspense fallback={<p role="status" className="mt-8 flex min-h-11 items-center border-t border-border pt-2 t-meta text-fg-3">Загружаем «Динамику по дням»…</p>}>
      <StreamedSalesDynamics
        id={SALES_DYNAMICS_ANCHOR}
        open={!canReadReport || typeof query.period === "string"}
        choices={choices}
        range={period.key === "custom" ? { from: period.from, to: period.to, max: period.today } : null}
        periodText={periodLabel(period)}
        formAction={`${FORM_ADDRESS(home)}#${SALES_DYNAMICS_ANCHOR}`}
        carry={carry}
        retryHref={salesDynamicsHref(query, period, SALES_DYNAMICS_ANCHOR, home)}
        read={dynamics}
      />
    </Suspense>
  );
  // Блок «Звонки» («Телефония Beeline KG», срез T10) — под «Динамикой по дням», с тем же периодом. Право и включатель `ui_enabled`
  // решает база; пока он выключен, блока нет вовсе. Пока читается, на его месте пусто.
  const callsSection = canReadTelephonyReport(actor) ? (
    <Suspense fallback={null}>
      <StreamedSalesCalls
        id={SALES_CALLS_ANCHOR}
        open={typeof query.period === "string"}
        choices={choices.map((one) => ({
          ...one,
          href: salesDynamicsHref(query, one.key === "custom" && period.key === "custom" ? period : { key: one.key }, SALES_CALLS_ANCHOR, home),
        }))}
        range={period.key === "custom" ? { from: period.from, to: period.to, max: period.today } : null}
        periodText={periodLabel(period)}
        formAction={`${FORM_ADDRESS(home)}#${SALES_CALLS_ANCHOR}`}
        carry={carry}
        retryHref={salesDynamicsHref(query, period, SALES_CALLS_ANCHOR, home)}
        read={readTelephonyReport(actor, { from: period.from, to: period.to })}
      />
    </Suspense>
  ) : null;
  const section = <>{dynamicsSection}{callsSection}</>;
  if (!canReadReport) return <SalesDynamicsNextView dynamics={section} tabs={tabs} />;
  return <SalesRegisterNextView actor={actor} query={query} dynamics={section} tabs={tabs} />;
}
