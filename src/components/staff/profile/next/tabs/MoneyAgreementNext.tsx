import { isStaffPreview } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import type { CaseAgreement } from "@/lib/platform-case-agreement-contract";
import type { PendingReceipt } from "@/lib/platform-pending-receipts-contract";
import type { StudentReceipt } from "@/lib/platform-student-receipts-contract";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";
import { readCaseAgreement } from "@/lib/v3/case-agreement-source";
import { readPendingReceipts } from "@/lib/v3/pending-receipts-source";
import { readStudentReceiptQueue } from "@/lib/v3/student-receipts-source";
import { caseMoneyWords } from "@/lib/v3/wording";

import { PaymentAddButton, PaymentDesk, PaymentFormSlot } from "../../PaymentDesk";
import { PaymentTable } from "../../PaymentTable";
import { PendingReceiptsCard } from "../../PendingReceiptsCard";
import { StudentReceiptsReview } from "../../StudentReceiptsReview";
import { MoneyCard } from "./MoneyCard";
import { MoneyStop, MoneySummary } from "./MoneySummary";

type Shared = Readonly<{ saleConditionsHref: string | null; financeStop: string | null; stopsPanel: boolean }>;

/**
 * Одна карточка «Оплата» из чтения 189. Чеки студента без оплаты и чеки из разбора документов
 * остаются в ней: куратор видит их и привязывает к платежу.
 */
export function AgreementNextView({ agreement, canWrite, today, pendingReceipts, pendingUnavailable = false, studentReceipts = [], financeStop, stopsPanel }: Shared & Readonly<{
  agreement: CaseAgreement; canWrite: boolean; today: string; pendingReceipts?: readonly PendingReceipt[]; pendingUnavailable?: boolean;
  studentReceipts?: readonly StudentReceipt[];
}>) {
  return (
    <PaymentDesk agreement={agreement} canWrite={canWrite} today={today}>
      <MoneyCard actions={<PaymentAddButton />}>
        <MoneySummary agreement={agreement} canWrite={canWrite} today={today} financeStop={financeStop} stopsPanel={stopsPanel} />
        {studentReceipts.length > 0 ? (
          <section id="case-receipts" data-testid="v3-case-student-receipts" className="grid gap-2 border-t border-border pt-3">
            <h3 className="t-item text-fg">{caseMoneyWords.pay.studentReceipts} <span className="font-normal tabular-nums text-fg-3">{studentReceipts.length}</span></h3>
            <p className="t-body-compact text-fg-2">{caseMoneyWords.pay.studentReceiptsNote}</p>
            <StudentReceiptsReview receipts={studentReceipts} showStudent={false} today={today} />
          </section>
        ) : null}
        <PaymentFormSlot />
        <PaymentTable />
        <PendingReceiptsCard receipts={pendingReceipts ?? []} payments={agreement.payments} canWrite={canWrite} today={today} />
        {pendingUnavailable ? <p role="alert" className="t-body-compact text-danger">Чеки из разбора документов не загрузились. Обновите страницу.</p> : null}
      </MoneyCard>
    </PaymentDesk>
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
  const [pending, studentQueue] = await Promise.all([
    readPendingReceipts(actor.organizationId, studentCaseId),
    readStudentReceiptQueue(actor, { studentCaseId }),
  ]);
  return (
    <AgreementNextView agreement={result.agreement} canWrite={result.agreement.canWrite && !isStaffPreview(actor)}
      today={dayInOrganizationTimezone(new Date())} pendingReceipts={pending.status === "ok" ? pending.receipts : []}
      pendingUnavailable={pending.status !== "ok"} studentReceipts={studentQueue.status === "ok" ? studentQueue.queue.receipts : []} {...shared} />
  );
}
