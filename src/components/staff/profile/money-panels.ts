import { isStaffPreview, staffHasPermission, staffPresentationCan } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { caseMoneyWords } from "@/lib/v3/wording";

import { CASE_MONEY_PANEL, type CaseMoneyPanelEntry } from "./case-money-view";
import type { ProfileDraft } from "./types";

/**
 * Что вкладка «Договор и оплата» показывает этому сотруднику и какие пункты «⋯» у неё есть. Одна сборка для прежнего вида
 * (`Money` в `tabs.tsx`) и «Нового вида» (`MoneyNext`): права и условия не расходятся между видами.
 *
 * - `financeCaseId` - дело, по которому читается и пишется финансовая часть (дело или дело переданного лида);
 * - `contractCaseId` - дело, чей раздел договора виден (у роли продаж его нет);
 * - `finance` - прочитанный финансовый контроль дела, когда финансы видимы;
 * - `operations` - дополнительные финансовые операции (не в просмотре роли, нужно право дела или подтверждения событий).
 */
export function moneyPanelPlan(input: Readonly<{
  draft: ProfileDraft;
  actor: ActivePlatformActor;
  salesCaseId?: string | null;
  financeVisible: boolean;
  contractWorkspace: boolean;
}>) {
  const { draft, actor, salesCaseId, financeVisible } = input;
  const financeCaseId = draft.admissions?.studentCaseId ?? salesCaseId ?? null;
  const contractCaseId = input.contractWorkspace && draft.contract && actor.presentationRole !== "sales"
    ? draft.contract.workspace.studentCaseId : null;
  // Navigation to the shared section does not grant any financial read access.
  const finance = financeVisible && draft.admissions?.finance ? draft.admissions : null;
  const operations = financeVisible && financeCaseId !== null && !isStaffPreview(actor)
    && (staffPresentationCan(actor, "admissions.read") || staffHasPermission(actor, "finance.event.confirm"));
  const words = caseMoneyWords.panels;
  const candidates: readonly (CaseMoneyPanelEntry | null)[] = [
    contractCaseId ? { id: CASE_MONEY_PANEL.contract, label: words.contract } : null,
    finance ? { id: CASE_MONEY_PANEL.obligations, label: words.obligations } : null,
    finance ? { id: CASE_MONEY_PANEL.stops, label: words.stops } : null,
    operations ? { id: CASE_MONEY_PANEL.operations, label: words.operations } : null,
    contractCaseId && draft.contract?.handoff ? { id: CASE_MONEY_PANEL.service, label: words.service } : null,
  ];
  const panels = candidates.filter((panel): panel is CaseMoneyPanelEntry => panel !== null);
  return { financeCaseId, contractCaseId, finance, operations, panels };
}
