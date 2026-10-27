import { salesHeadlinePeriod } from "@/components/v3/SalesPeriodHeadline";
import { staffHasPermission, isStaffPreview, staffPresentationCan } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { getPlatformSalesLead } from "@/lib/platform-sales";
import { parseSalesUuid, type SalesRegisterIntakeOptions, type SalesRegisterRow, type SalesRegisterWorkspace } from "@/lib/platform-sales-register-contract";
import type { MonthlyPaymentSummaryRead } from "@/lib/platform-finance-entry-contract";
import type { SalesCountRead } from "@/lib/sales-numbers-contract";
import { salesDirectionControl } from "@/lib/sales-register-directions";
import type { SalesRegisterManagementRead } from "@/lib/sales-register-management";
import { salesReportContext, type SalesReportQuery } from "@/lib/sales-register-navigation";
import { SALES_PAGE_SIZE, SALES_SUMMARY_MAX_PAGES, salesMoneySummary, salesSummaryBasis } from "@/lib/sales-register-view";
import { readMonthlyPaymentSummary } from "@/lib/v3/finance-entry-source";
import { ORG_TIMEZONE } from "@/lib/v3/period";
import { readSalesCount } from "@/lib/v3/sales-numbers-source";
import {
  readSalesRecordLeadLink, readSalesRegisterDirections, readSalesRegisterIntakeOptions, readSalesRegisterManagement, readSalesRegisterWorkspace,
  readSalesRegisterWriteAccess,
} from "@/lib/v3/sales-register-source";

/**
 * Чтения «Отчёта продаж» и то, что из них выводится для обоих видов (прежнего `SalesRegisterView` и «Нового вида»
 * `SalesRegisterNextView`): одни и те же источники, права и порядок чтений. Вынесено из `SalesRegisterView.tsx` без изменений
 * логики; прежний вид по-прежнему рисует то, что получил отсюда.
 */

/** Все записи выборки для остатка: те же фильтры, страницы по 50, до 10 страниц. */
export async function readSummaryRows(
  actor: ActivePlatformActor,
  first: SalesRegisterWorkspace,
  offset: number,
  selection: Omit<Parameters<typeof readSalesRegisterWorkspace>[1], "offset" | "recordId">,
): Promise<Readonly<{ rows: readonly SalesRegisterRow[] }> | Readonly<{ rows: null; reason: "too_many" | "unavailable" }>> {
  const pages = Math.ceil(first.totalCount / SALES_PAGE_SIZE);
  if (pages <= 1 && offset === 0) return { rows: first.rows };
  if (pages > SALES_SUMMARY_MAX_PAGES) return { rows: null, reason: "too_many" };
  const reads = await Promise.all(Array.from({ length: pages }, (_, index) => index * SALES_PAGE_SIZE).map((pageOffset) =>
    pageOffset === offset ? Promise.resolve(first) : readSalesRegisterWorkspace(actor, { ...selection, offset: pageOffset }).catch(() => null)));
  if (reads.some((read) => read === null || read.totalCount !== first.totalCount)) return { rows: null, reason: "unavailable" };
  const rows = reads.flatMap((read) => read!.rows);
  // Выборка сменилась между чтениями — числа не складываются, остатка нет.
  if (rows.length !== first.totalCount || new Set(rows.map((row) => row.id)).size !== rows.length) return { rows: null, reason: "unavailable" };
  return { rows };
}

export async function readSalesRegisterPage(actor: ActivePlatformActor, query: SalesReportQuery) {
  const now = new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const { year, month, offset, searchQuery, saleSlice, saleSliceHref, valid, reportMonth, params, href, clearFiltersHref, importHref } = salesReportContext(query, {
    year: Number(now.find(p => p.type === "year")!.value), month: Number(now.find(p => p.type === "month")!.value),
  });
  const writeAccess = await readSalesRegisterWriteAccess(actor);
  const canManage = writeAccess === "allowed";
  const viewingRecord = Boolean(query.record);
  const creating = query.new === "true" && !viewingRecord;
  const editingRecord = viewingRecord && query.edit === "true";
  // Новая продажа — отдельная страница формы; всё остальное — список (и панель записи).
  const creatingForm = creating && canManage;
  const directionsPromise = !creatingForm ? readSalesRegisterDirections(actor).catch(() => null) : Promise.resolve(null);
  const managementPromise: Promise<SalesRegisterManagementRead> = valid && !creatingForm
    ? readSalesRegisterManagement(actor, month && query.archived !== "true" ? reportMonth : null)
    : Promise.resolve({ status: "denied" });
  const checkFinanceAccess = staffHasPermission(actor, "finance.read.full") && !isStaffPreview(actor);
  const selection = {
    year, month, archived: query.archived === "true", manager: query.manager, direction: query.direction,
    needsReview: query.review ? query.review === "true" : null, query: searchQuery, saleSlice,
  };
  let workspace: SalesRegisterWorkspace | null = null;
  let intakeOptions: SalesRegisterIntakeOptions | null = null;
  let cash: MonthlyPaymentSummaryRead | Readonly<{ status: "unavailable" }> | null = null;
  // «Продажи» периода по одному определению (Э2): не зависит от фильтров строк.
  const headlinePeriod = valid ? salesHeadlinePeriod(year, month) : null;
  let salesCount: SalesCountRead | null = null;
  // «Нужно уточнить · N»: то же чтение с отметкой; нет чтения — нет числа.
  let reviewCount: number | null = null;
  // «Оформить продажу» из Lead 360: имя лида для прежнего поиска формы.
  let initialLead: Readonly<{ id: string; query: string }> | null = null;
  if (valid) {
    const leadId = creatingForm && typeof query.lead === "string" ? parseSalesUuid(query.lead) : null;
    let reviewRead: number | null;
    [workspace, cash, intakeOptions, salesCount, reviewRead, initialLead] = await Promise.all([
      readSalesRegisterWorkspace(actor, { ...selection, offset, recordId: query.record ?? query.saved }).catch(() => null),
      checkFinanceAccess && month && !creatingForm ? readMonthlyPaymentSummary(actor, year, month)
        .catch(() => ({ status: "unavailable" as const })) : Promise.resolve(null),
      creatingForm ? readSalesRegisterIntakeOptions(actor).catch(() => null) : Promise.resolve(null),
      headlinePeriod && !creatingForm ? readSalesCount(actor, headlinePeriod) : Promise.resolve(null),
      !creatingForm && query.review !== "true"
        ? readSalesRegisterWorkspace(actor, { ...selection, needsReview: true, offset: 0 }).then((read) => read.totalCount, () => null)
        : Promise.resolve(null),
      leadId ? getPlatformSalesLead(actor, leadId).then((lead) => lead?.clientDisplayName ? { id: lead.leadId, query: lead.clientDisplayName } : null, () => null)
        : Promise.resolve(null),
    ]);
    reviewCount = query.review === "true" ? workspace?.totalCount ?? null : reviewRead;
  }
  const archiveView = query.archived === "true";
  // «Архив» — без сумм и остатка (как на сервере и до Э4): все страницы для остатка не читаются.
  const summaryRead = workspace && !creatingForm && !archiveView ? await readSummaryRows(actor, workspace, offset, selection) : null;
  const summary = summaryRead?.rows ? salesMoneySummary(summaryRead.rows) : null;
  const summaryBasis = summaryRead?.rows ? salesSummaryBasis(summaryRead.rows, { year, month }) : null;
  const management = await managementPromise;
  const canTarget = management.status === "ready" && management.data.canManageTarget;
  const canImport = management.status === "ready" && management.data.canImport;
  const managementUnavailable = management.status === "unavailable";
  // Hints only retain disabled drafts on a failed read; they never grant a write.
  const showTargetForm = canTarget || (managementUnavailable && !isStaffPreview(actor) && staffHasPermission(actor, "sales.register.target.manage"));
  const directions = await directionsPromise;
  const directionControl = salesDirectionControl(directions, query.direction);
  const rowFilters = Boolean(searchQuery || query.manager || query.direction || query.review || query.archived === "true");
  const hasFilters = rowFilters || Boolean(saleSlice);
  // Во «Весь год» и в срезе «записаны в другой месяц отчёта» у строк разные месяцы отчёта — его видно в строке.
  const showReportMonth = month === undefined || saleSlice === "filed_elsewhere";
  const saved = !creatingForm && !viewingRecord && query.saved && workspace?.selected?.id === query.saved ? workspace.selected : null;
  // Дело, которое открыла эта продажа: адрес приходит из формы после сохранения, в нём только идентификатор.
  const savedCaseId = saved && typeof query.case === "string" ? parseSalesUuid(query.case) : null;
  // Карточку дела читает только тот, у кого есть право на дела (admissions.read); у Sales его нет — им остаётся карточка лида.
  const canOpenSavedCase = savedCaseId !== null && staffPresentationCan(actor, "admissions.read");
  const target = management.status === "ready" ? management.data.target : null;
  const backHref = viewingRecord && workspace?.selected ? `${href()}#sale-${workspace.selected.id}` : href();
  const panelOpen = viewingRecord && !creatingForm;
  const editing = editingRecord && canManage;
  // «Связать с лидом» (Э8.7, 28.09.2026): только для просмотра импортированной
  // записи; отдельное чтение — read_sales_register_v4 не трогаем. Не
  // прочитано — строки нет вовсе, а не угаданное «не связана».
  const linkedRecord = panelOpen && !editing ? workspace?.selected ?? null : null;
  const showLeadLink = Boolean(linkedRecord && linkedRecord.sourceKind === "import");
  const leadLinkRead = showLeadLink && linkedRecord ? await readSalesRecordLeadLink(actor, linkedRecord.id) : null;
  const leadLink = leadLinkRead?.status === "ready" ? leadLinkRead.link : null;
  const showLeadRow = showLeadLink && leadLinkRead?.status === "ready" && (leadLink !== null || canManage);
  // Запись открывается просмотром (Э8.6); «Исправить запись» — форма, «Отмена» формы — снова просмотр.
  const recordHref = workspace?.selected ? href({ record: workspace.selected.id }) : backHref;
  return {
    year, month, offset, searchQuery, saleSlice, saleSliceHref, valid, reportMonth, params, href, clearFiltersHref, importHref, writeAccess, canManage, viewingRecord, creating, editingRecord, creatingForm, workspace, intakeOptions, cash, headlinePeriod, salesCount, reviewCount, initialLead, archiveView, summaryRead, summary, summaryBasis, management, canTarget, canImport, managementUnavailable, showTargetForm, directions, directionControl, rowFilters, hasFilters, showReportMonth, saved, savedCaseId, canOpenSavedCase, target, backHref, panelOpen, editing, linkedRecord, showLeadLink, leadLinkRead, leadLink, showLeadRow, recordHref,
  };
}

export type SalesRegisterPage = Awaited<ReturnType<typeof readSalesRegisterPage>>;
