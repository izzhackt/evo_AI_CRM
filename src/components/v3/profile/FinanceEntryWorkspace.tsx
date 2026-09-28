import { isStaffPreview } from "@/lib/platform-access";
import { randomUUID } from "node:crypto";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { financeMoney, type FinanceEntryWorkspace as Workspace } from "@/lib/platform-finance-entry-contract";
import { readFinanceEntryWorkspace } from "@/lib/v3/finance-entry-source";
import { FinanceEntryForm } from "./FinanceEntryForms";
import { caseMomentLabel } from "./case-work-view";
import { dayInOrganizationTimezone } from "@/lib/platform-task-deadline";

/**
 * Панель «Дополнительные финансовые операции» вкладки «Договор и оплата»
 * (Э8.3): заголовок — у панели, здесь только формы и история операций.
 */
export async function FinanceEntryWorkspace({ caseId }: Readonly<{ caseId: string }>) {
  const actor = await requirePlatformStaffActor();
  if (isStaffPreview(actor)) return null;
  let workspace: Workspace;
  try { workspace = await readFinanceEntryWorkspace(actor, caseId); }
  catch { return <p role="alert" className="py-2 t-body-compact text-fg-2">Финансовая история сейчас недоступна. Обновите страницу; новые операции пока остановлены.</p>; }
  const today = dayInOrganizationTimezone(new Date());
  return <div>
    {workspace.canCreate ? <FinanceEntryForm workspace={workspace} operation="obligation" requestId={randomUUID()} /> : null}
    {workspace.canRecord && workspace.obligations.length > 0 ? <>
      <FinanceEntryForm workspace={workspace} operation="payment" requestId={randomUUID()} />
      <FinanceEntryForm workspace={workspace} operation="refund" requestId={randomUUID()} />
    </> : null}
    {!workspace.canCreate && !workspace.canRecord ? <p className="py-2 t-body-compact text-fg-2">Внесение операций доступно сотрудникам с действующим финансовым разрешением.</p> : null}
    {workspace.canReadEvents ? <details className="border-t border-border"><summary className="min-h-11 cursor-pointer py-3 t-item text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring">История операций · {workspace.events.length}</summary>
      {workspace.events.length ? <ul className="border-t border-border">{workspace.events.map(event => <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border py-2 t-body-compact">
        <span className="min-w-0">{event.type === "payment" ? "Оплата" : "Возврат"} · {workspace.obligations.find(o => o.id === event.obligationId)?.label}<time dateTime={event.occurredAt} className="block font-mono t-meta tabular-nums text-fg-2">{caseMomentLabel(event.occurredAt, today)}</time></span>
        <span className="tabular-nums">{financeMoney(event.amountMinor, event.currency)}</span>
      </li>)}</ul> : <p className="pb-3 t-body-compact text-fg-2">Подтверждённых операций пока нет.</p>}
    </details> : <p className="py-2 t-body-compact text-fg-2">Детальная история платежей ограничена финансовыми правами.</p>}
  </div>;
}
