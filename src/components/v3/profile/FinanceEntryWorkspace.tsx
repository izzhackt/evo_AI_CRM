import { randomUUID } from "node:crypto";
import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { financeMoney, type FinanceEntryWorkspace as Workspace } from "@/lib/platform-finance-entry-contract";
import { readFinanceEntryWorkspace } from "@/lib/v3/finance-entry-source";
import { FinanceEntryForm } from "./FinanceEntryForms";
import { Card } from "./Card";

export async function FinanceEntryWorkspace({ caseId }: Readonly<{ caseId: string }>) {
  const actor = await requirePlatformStaffActor();
  if (actor.presentationRole !== actor.authorityRole || actor.authorityRole === "sales") return null;
  let workspace: Workspace;
  try { workspace = await readFinanceEntryWorkspace(actor, caseId); }
  catch { return <Card title="Оплаты и возвраты"><p role="alert" className="px-4 py-3 text-sm text-fg-2">Финансовая история сейчас недоступна. Обновите страницу; новые операции пока остановлены.</p></Card>; }
  return <Card title="Оплаты и возвраты"><div className="px-4 py-3">
    {workspace.canCreate ? <FinanceEntryForm workspace={workspace} operation="obligation" requestId={randomUUID()} /> : null}
    {workspace.canRecord && workspace.obligations.length > 0 ? <>
      <FinanceEntryForm workspace={workspace} operation="payment" requestId={randomUUID()} />
      <FinanceEntryForm workspace={workspace} operation="refund" requestId={randomUUID()} />
    </> : null}
    {!workspace.canCreate && !workspace.canRecord ? <p className="py-3 text-sm text-fg-2">Внесение операций доступно сотрудникам с действующим финансовым разрешением.</p> : null}
    {workspace.canReadEvents ? <details className="border-t border-border"><summary className="min-h-11 cursor-pointer py-3 font-medium">История операций · {workspace.events.length}</summary>
      {workspace.events.length ? <ul className="divide-y divide-border">{workspace.events.map(event => <li key={event.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
        <span>{event.type === "payment" ? "Оплата" : "Возврат"} · {workspace.obligations.find(o => o.id === event.obligationId)?.label}<span className="mt-1 block text-xs text-fg-2">{new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))} · Бишкек</span></span>
        <span className="font-mono">{financeMoney(event.amountMinor, event.currency)}</span>
      </li>)}</ul> : <p className="pb-3 text-sm text-fg-2">Подтверждённых операций пока нет.</p>}
    </details> : <p className="py-3 text-sm text-fg-2">Детальная история платежей ограничена финансовыми правами.</p>}
  </div></Card>;
}
