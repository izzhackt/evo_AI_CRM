import { randomUUID } from "node:crypto";

import { Card } from "@/components/ui/card";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { type SalesReportQuery } from "@/lib/sales-register-navigation";
import { SALES_PAGE_SIZE } from "@/lib/sales-register-view";
import { readSalesRegisterPage } from "@/lib/v3/sales-register-page";

import { SalesPeriodStepper } from "../sales-report/SalesPeriodStepper";
import { SalesReportToolbar } from "../sales-report/SalesReportToolbar";
import { SalesRegisterForm, SalesTargetForm } from "../SalesRegisterForms";
import { SalesReportNextLazy } from "./SalesNextLazy";
import { buildSalesSheet } from "./sales-next-sheet";
import { salesRowData, salesMoney, salesTidy } from "./sales-next-rows";
import { SALE_SLICE_TITLE } from "../SalesRegisterView";
import { salesArchiveText, salesCashData, salesHeadlineData, salesMoneyData } from "./sales-next-summary";
import { salesToolbarInputs } from "./sales-next-toolbar";

const dateLabel = (date: string | null) => (date ? date.split("-").reverse().join(".") : "Дата не указана");

/**
 * «Отчёт продаж» нового вида (решение владельца 27.10.2026). Читает ровно то же, что прежний `SalesRegisterView` (`readSalesRegisterPage`:
 * те же чтения, права и порядок), готовит простые данные и серверные части (панель записи, форма плана, строка фильтров, «Динамика»,
 * «Звонки») и отдаёт их ленивому входу `SalesReportNextLazy`. Данные записи вне строки (телефон, заметки, источник) в клиентские
 * свойства не идут: их рисует панель на сервере.
 */
export async function SalesRegisterNextView({ actor, query, dynamics = null }: Readonly<{ actor: ActivePlatformActor; query: SalesReportQuery; dynamics?: React.ReactNode }>) {
  const page = await readSalesRegisterPage(actor, query);
  const { workspace, year, month, offset, searchQuery, valid, reportMonth, href, clearFiltersHref, writeAccess, canManage, creating, creatingForm, editingRecord,
    archiveView, hasFilters, rowFilters, showReportMonth, saleSlice, headlinePeriod, salesCount, target, intakeOptions, initialLead, backHref } = page;

  if (creatingForm) {
    // Новая продажа — отдельная страница формы; форма та же (с её заголовком и «← К отчёту»), в карточке нового вида.
    return (
      <main data-testid="v3-sales-new" className="mx-auto w-full max-w-[860px] px-4 py-8 sm:px-6">
        <Card className="px-5">
          <SalesRegisterForm key="new" record={null} recordId={null} reportMonth={reportMonth} ownerOptions={workspace?.ownerOptions ?? []} canChooseOwner={canManage}
            requestId={randomUUID()} archiveRequestId={randomUUID()} backHref={backHref} readUnavailable={!workspace} ownMembershipId={actor.membershipId}
            ownLabel={actor.displayName} intakeOptions={intakeOptions} initialLead={initialLead} />
        </Card>
      </main>
    );
  }

  const tools = salesToolbarInputs(page, query, actor);
  const managerName = (row: { managerKey: string | null; managerLabel: string }) => workspace?.managerOptions.find((option) => option.key === row.managerKey)?.name ?? salesTidy(row.managerLabel);
  const showAction = canManage && !archiveView;
  const rows = workspace?.rows.map((row) => salesRowData(row, { year, href: href({ record: row.id }), manager: managerName(row), showReportMonth, actionRequestId: showAction && !row.archived ? randomUUID() : null })) ?? [];
  const savedRow = page.saved;
  const yearOnly = month === undefined;
  const filedElsewhere = saleSlice === "filed_elsewhere";
  const emptyTitle = offset > 0 ? "На этой странице записей нет." : hasFilters ? "По выбранным фильтрам записей не найдено." : "В выбранном периоде записей нет.";
  const emptyAction = offset > 0 ? { href: href({ offset: "0" }), label: "К началу списка" } : hasFilters ? { href: clearFiltersHref, label: "Сбросить фильтры" } : null;
  const planForm = page.showTargetForm && month && !archiveView
    ? <SalesTargetForm key={reportMonth} reportMonth={reportMonth} target={target} requestId={randomUUID()} readUnavailable={!workspace || page.managementUnavailable} /> : null;
  const importHref = tools.importLinkHere ? page.importHref : null;

  return (
    <SalesReportNextLazy
      period={page.valid ? <SalesPeriodStepper year={year} month={month} steps={tools.steps} periodHref={tools.periodHref} /> : null}
      addHref={workspace && canManage ? href({ new: "true" }) : null}
      alerts={[
        ...(writeAccess === "unavailable" ? [{ role: "alert" as const, text: "Не удалось проверить права на запись продажи. Обновите страницу перед добавлением или изменением." }] : []),
        ...((creating || editingRecord) && writeAccess === "denied" ? [{ role: "status" as const, text: "Добавление и исправление продаж доступны Sales Manager." }] : []),
      ]}
      headline={salesCount && headlinePeriod ? salesHeadlineData(salesCount, { label: headlinePeriod.label, retryHref: href(), filtered: hasFilters, sliceHref: page.saleSliceHref, target: month && !archiveView ? target?.targetCount ?? null : null }) : null}
      saved={savedRow ? { name: savedRow.applicantName, facts: `${dateLabel(savedRow.signingDate)} · ${salesMoney(savedRow.serviceCostMinor, savedRow.serviceCostCurrency) ?? "Не уточнено"}`,
        caseCreated: page.savedCaseId !== null, openHref: page.canOpenSavedCase && page.savedCaseId ? `/v3/profile?case=${encodeURIComponent(page.savedCaseId)}` : savedRow.leadId ? `/v3/profile?id=${encodeURIComponent(savedRow.leadId)}` : null } : null}
      failure={workspace ? null : { text: searchQuery === null ? "Введите поисковый запрос до 200 символов без переносов строк." : valid ? "Не удалось загрузить отчёт. Проверьте подключение и повторите загрузку." : "Проверьте год, месяц и номер страницы.",
        link: { href: "/v3/main?view=sales", label: "Открыть текущий месяц" } }}
      money={workspace && !archiveView ? salesMoneyData({ workspace, summary: page.summary, basis: page.summaryBasis, reason: page.summaryRead && page.summaryRead.rows === null ? page.summaryRead.reason : null,
        filtered: filedElsewhere ? rowFilters : hasFilters, yearOnly, filedElsewhere }) : null}
      archive={workspace && archiveView ? salesArchiveText(workspace.totalCount, yearOnly, Boolean(searchQuery || query.manager || query.direction || query.review)) : null}
      toolbar={workspace ? (
        <SalesReportToolbar workspace={workspace} query={query} params={page.params} searchQuery={searchQuery} hidden={tools.hidden} activeCount={tools.activeCount}
          selectedManager={tools.selectedManager} selectedManagerName={tools.selectedManagerName} directionControl={page.directionControl} directionGroups={tools.directionGroups}
          selectedDirection={tools.selectedDirection} filterHref={tools.filterHref} managersHref={tools.managersHref} reviewCount={page.reviewCount} hasFilters={hasFilters} clearFiltersHref={clearFiltersHref} />
      ) : null}
      variantNote={tools.variantNote}
      slice={saleSlice && headlinePeriod ? { text: `${SALE_SLICE_TITLE[saleSlice]} — ${headlinePeriod.label}.`, link: { href: clearFiltersHref, label: "Все записи периода" } } : null}
      table={workspace ? {
        rows, openKey: page.viewingRecord ? query.record ?? null : null, listHref: href(), showRest: !archiveView, showAction, count: workspace.totalCount,
        sheet: page.panelOpen ? buildSalesSheet(page, query, actor, { managerName }) : null,
        empty: { title: emptyTitle, description: offset > 0 ? "Вернитесь к началу списка с теми же фильтрами." : hasFilters ? "Измените или сбросьте фильтры. Выбранный период сохранится." : "Выберите другой месяц или весь год в переключателе выше.", action: emptyAction },
      } : null}
      pagination={workspace && (offset > 0 || workspace.hasMore) ? { prevHref: offset > 0 ? href({ offset: String(Math.max(0, offset - SALES_PAGE_SIZE)) }) : null,
        nextHref: workspace.hasMore ? href({ offset: String(offset + SALES_PAGE_SIZE) }) : null, range: workspace.rows.length ? `${offset + 1}–${offset + workspace.rows.length} из ${workspace.totalCount}` : "" } : null}
      cash={workspace && month ? salesCashData(page.cash) : null}
      plan={planForm || importHref || page.managementUnavailable ? { target: target?.targetCount ?? null, form: planForm, importHref, unavailable: page.managementUnavailable } : null}
      dynamics={dynamics}
    />
  );
}
