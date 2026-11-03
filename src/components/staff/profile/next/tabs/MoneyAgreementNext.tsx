import { isStaffPreview } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { CaseAgreement } from "@/lib/platform-case-agreement-contract";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { readCaseAgreement } from "@/lib/v3/case-agreement-source";
import { caseMoneyWords } from "@/lib/v3/wording";

import { MoneyCard } from "./MoneyCard";
import { PaymentsCard, TranchesCard } from "./MoneyLists";
import { MoneyStop, MoneySummary } from "./MoneySummary";

type Shared = Readonly<{ saleConditionsHref: string | null; financeStop: string | null; stopsPanel: boolean }>;

/** Сводка, транши и оплаты из уже прочитанного (чтение 189) - соседние карточки листа; статический рендер берёт этот вид с синтетикой. */
export function AgreementNextView({ agreement, canWrite, today, ...shared }: Shared & Readonly<{ agreement: CaseAgreement; canWrite: boolean; today: string }>) {
  return (
    <>
      <MoneyCard><MoneySummary agreement={agreement} canWrite={canWrite} today={today} {...shared} /></MoneyCard>
      <TranchesCard agreement={agreement} canWrite={canWrite} today={today} />
      <PaymentsCard agreement={agreement} canWrite={canWrite} today={today} />
    </>
  );
}

/** Нет суммы: слова, что именно (роли не видна или сбой чтения), и стоп, если он есть - он виден и без сумм. */
export function MoneyNotice({ role, text, financeStop, stopsPanel }: Readonly<Pick<Shared, "financeStop" | "stopsPanel"> & { role?: "alert"; text: string }>) {
  return (
    <MoneyCard>
      <div className="grid grid-cols-1 gap-3">
        <p role={role} className={role === "alert" ? "t-body-compact text-danger" : "t-body-compact text-fg-2"}>{text}</p>
        {financeStop ? <MoneyStop reason={financeStop} stopsPanel={stopsPanel} /> : null}
      </div>
    </MoneyCard>
  );
}

/**
 * Чтение 189 (`readCaseAgreement`) - то же, что у `CaseAgreementBlock`: отказ по правам - слова, что суммы роли не видны; сбой - честное
 * «недоступно». Суммы только из чтения; права записи - `canWrite` чтения и не просмотр роли.
 */
export async function CaseAgreementNext({ actor, studentCaseId, ...shared }: Shared & Readonly<{ actor: ActivePlatformActor; studentCaseId: string }>) {
  const result = await readCaseAgreement(actor, studentCaseId);
  if (result.status !== "ok") {
    const unavailable = result.status === "unavailable";
    return <MoneyNotice role={unavailable ? "alert" : undefined} text={unavailable ? caseMoneyWords.financeUnavailable : caseMoneyWords.financeHidden} {...shared} />;
  }
  return (
    <AgreementNextView agreement={result.agreement} canWrite={result.agreement.canWrite && !isStaffPreview(actor)}
      today={dayInOrganizationTimezone(new Date())} {...shared} />
  );
}
