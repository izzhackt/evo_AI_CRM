import type { ReactNode } from "react";

import type { ActivePlatformActor } from "@/lib/platform-auth";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { caseMoneyWords } from "@/lib/v3/wording";

import { CaseMoneyPanel, CaseMoneySection } from "../../CaseMoney";
import { CASE_MONEY_PANEL } from "../../case-money-view";
import { FinanceEntryWorkspace } from "../../FinanceEntryWorkspace";
import { moneyPanelPlan } from "../../money-panels";
import { ProfileFinanceControls } from "../../ProfileAdmissionsWorkspace";
import type { PersonProfile, ProfileDraft } from "../../types";
import { CaseAgreementNext, MoneyNotice } from "./MoneyAgreementNext";
import { MoneyObligations } from "./MoneyObligations";

/**
 * «Договор и оплата» в «Новом виде»: лист - набор карточек (сводка с «⋯», транши, оплаты), а открытая панель «⋯» - ещё одна
 * карточка под ними. Права, чтения и команды те же, что у `Money` (`moneyPanelPlan` одна на оба вида): финансы видны - сумма из
 * чтения 189, нет - слова; раздел договора (`contractWorkspace`), стопы и финансовые операции - прежние части в панелях. Состояние
 * панелей, якоря адреса (`#money-stops`, `#contract-workflow`) и возврат фокуса держит `CaseMoneySection`.
 */
export function MoneyNext({ profile, draft, actor, salesCaseId, saleConditionsHref, financeVisible, contractWorkspace }: Readonly<{
  profile: PersonProfile;
  draft: ProfileDraft;
  actor: ActivePlatformActor;
  salesCaseId?: string | null;
  saleConditionsHref: string | null;
  financeVisible: boolean;
  contractWorkspace: ReactNode;
}>) {
  const { financeCaseId, contractCaseId, finance, operations, panels } = moneyPanelPlan({
    draft, actor, salesCaseId, financeVisible, contractWorkspace: Boolean(contractWorkspace),
  });
  const words = caseMoneyWords.panels;
  return (
    <CaseMoneySection nextUi panels={panels} contractCaseId={contractCaseId}>
      {!financeVisible ? (
        <MoneyNotice text={caseMoneyWords.financeHidden} financeStop={null} stopsPanel={false} />
      ) : financeCaseId ? (
        <CaseAgreementNext actor={actor} studentCaseId={financeCaseId} saleConditionsHref={saleConditionsHref}
          financeStop={profile.financeStop} stopsPanel={finance !== null} />
      ) : (
        <MoneyNotice text={caseMoneyWords.noCase} financeStop={null} stopsPanel={false} />
      )}
      {contractWorkspace}
      {finance ? (
        <CaseMoneyPanel id={CASE_MONEY_PANEL.obligations} label={words.obligations} help="Услуги EVO и другие расходы по делу.">
          <MoneyObligations draft={draft} today={dayInOrganizationTimezone(new Date())} />
        </CaseMoneyPanel>
      ) : null}
      {finance ? (
        <CaseMoneyPanel id={CASE_MONEY_PANEL.stops} label={words.stops}>
          <ProfileFinanceControls actor={actor} workspace={finance} />
        </CaseMoneyPanel>
      ) : null}
      {operations && financeCaseId ? (
        <CaseMoneyPanel id={CASE_MONEY_PANEL.operations} label={words.operations}>
          <FinanceEntryWorkspace caseId={financeCaseId} />
        </CaseMoneyPanel>
      ) : null}
    </CaseMoneySection>
  );
}
