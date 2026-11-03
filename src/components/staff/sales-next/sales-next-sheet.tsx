import { randomUUID } from "node:crypto";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { SalesRegisterRow } from "@/lib/platform-sales-register-contract";
import type { SalesReportQuery } from "@/lib/sales-register-navigation";
import type { SalesRegisterPage } from "@/lib/v3/sales-register-page";

import { SalesRecordLeadFact, SalesRecordLeadMenu } from "../SalesRecordLeadLink";
import { SalesRecordPreview, salesRecordPanelHeader } from "../SalesRecordPreview";
import { SalesRegisterForm } from "../SalesRegisterForms";
import { SalesWithdrawalControl } from "../SalesWithdrawal";
import type { SalesSheetContent } from "./SalesRecordsTable";

const PANEL_HEADING = "sale-panel-title";

/**
 * Панель открытой записи нового вида: шапка — прежние тексты (`salesRecordPanelHeader`), тело — прежние просмотр (`SalesRecordPreview`)
 * или форма «Исправить запись» (`SalesRegisterForm`), «Убрать» / «Вернуть» и «Связать с лидом» с теми же request_id и командами.
 * Строится на сервере: телефон, заметки и источник записи остаются у сервера, в свойства таблицы не идут.
 */
export function buildSalesSheet(page: SalesRegisterPage, query: SalesReportQuery, actor: ActivePlatformActor, helpers: Readonly<{ managerName: (row: SalesRegisterRow) => string }>): SalesSheetContent | null {
  const { workspace, editing, canManage, year, reportMonth, href, backHref, recordHref, linkedRecord, leadLink, showLeadRow } = page;
  if (!workspace) return null;
  const header = salesRecordPanelHeader(workspace.selected ?? null, editing);
  const selected = workspace.selected ?? null;
  return {
    title: header.title,
    description: header.context ?? undefined,
    open: header.open,
    extra: leadLink && leadLink.visible && canManage && linkedRecord ? (
      <SalesRecordLeadMenu record={{ id: linkedRecord.id, version: linkedRecord.version }} leadName={leadLink.name} requestId={randomUUID()} />
    ) : null,
    body: (
      <>
        <h2 id={PANEL_HEADING} className="sr-only">Сведения записи</h2>
        {editing ? (
          <SalesRegisterForm key={query.record} record={selected} recordId={query.record ?? null} reportMonth={reportMonth} ownerOptions={workspace.ownerOptions}
            canChooseOwner={canManage} requestId={randomUUID()} archiveRequestId={randomUUID()} backHref={recordHref} readUnavailable={false}
            ownMembershipId={actor.membershipId} ownLabel={actor.displayName} panelHeadingId={PANEL_HEADING} />
        ) : (
          <SalesRecordPreview record={selected} backHref={backHref} panelHeadingId={PANEL_HEADING} managerName={selected ? helpers.managerName(selected) : null} year={year}
            editHref={canManage && selected ? href({ record: selected.id, edit: "true" }) : null}
            withdrawalAction={canManage && selected && !selected.archived ? (
              <SalesWithdrawalControl record={{ id: selected.id, version: selected.version }} name={selected.applicantName} withdrawn={selected.withdrawal !== null} requestId={randomUUID()} align="start" />
            ) : null}
            leadRow={showLeadRow && linkedRecord ? (
              <SalesRecordLeadFact link={leadLink} canManage={canManage} record={{ id: linkedRecord.id, version: linkedRecord.version }} requestId={randomUUID()} />
            ) : null} />
        )}
      </>
    ),
  };
}
