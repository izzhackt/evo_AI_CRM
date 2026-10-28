import Link from "next/link";

import { KeyFacts, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { AccountDeletionEmailRetry } from "@/components/v3/settings/AccountDeletionEmailRetry";
import { AccountDeletionManualDone } from "@/components/v3/settings/AccountDeletionManualDone";
import { AccountDeletionProcess } from "@/components/v3/settings/AccountDeletionProcess";
import { modeText } from "@/components/v3/settings/AccountDeletionSection";
import { accountDeletionDate, accountDeletionDueText, type AccountDeletionDetail } from "@/lib/account-deletion-contract";
import type { AccountDeletionDetailRead } from "@/lib/v3/account-deletion-source";

import { DeletionNotices } from "./DeletionNotices";
import { AutomaticPlan, ManualPlan } from "./DeletionPlans";
import { deletionStatusBadge } from "./deletion-rows";

const Day = ({ at }: Readonly<{ at: string }>) => <time dateTime={at} className="tabular-nums">{accountDeletionDate(at)}</time>;

/**
 * Запрос на удаление в панели: ключевые данные (запрос, срок со словом о сроке, состояние), итог и предупреждения, затем план —
 * автоматический (что удалится; «Удалить навсегда» со словом «удалить») или ручной (список для команды; «Отметить выполненным»).
 * Действия — прежние (`AccountDeletionProcess`, `AccountDeletionManualDone`, `AccountDeletionEmailRetry`): те же поля и команды.
 */
export function DeletionDetailBody({ read, nowIso }: Readonly<{ read: AccountDeletionDetailRead; nowIso: string }>) {
  if (read.status !== "ready") {
    return (
      <p role="alert" className="t-body-compact text-danger">
        {read.status === "not_found" ? "Такого запроса нет." : read.status === "forbidden"
          ? "Запросы на удаление видит и выполняет только администратор." : "Не удалось загрузить запрос. Обновите страницу."}
      </p>
    );
  }
  const d: AccountDeletionDetail = read.detail;
  const due = accountDeletionDueText(d, new Date(nowIso));
  const open = d.status !== "completed";
  return (
    <div className="grid gap-4" data-testid="v3-deletion-detail" data-status={d.status} data-mode={d.mode}>
      <KeyFacts columns={3} facts={[
        { label: "Запрос", value: <Day at={d.requestedAt} /> },
        { label: "Срок", value: <span className="flex flex-wrap items-center gap-1.5"><span className={d.overdue ? "font-medium text-danger" : undefined}><Day at={d.dueAt} /></span><StatusBadge tone={due.tone === "danger" ? "danger" : due.tone === "warn" ? "warn" : "neutral"} label={due.text} /></span> },
        { label: "Состояние", value: <span className="flex flex-wrap items-center gap-1.5">{deletionStatusBadge(d)}<span className="text-fg-2">{modeText(d)}</span></span> },
      ]} />
      {d.studentCaseId && open ? <div><Button variant="outline" asChild><Link href={`/v3/profile?case=${d.studentCaseId}&tab=overview`}>Открыть дело</Link></Button></div> : null}
      <DeletionNotices d={d} />
      {d.status === "completed" && d.confirmationEmailStatus === null ? <AccountDeletionEmailRetry requestRowId={d.id} requestedAt={d.requestedAt} /> : null}
      {d.mode === "automatic" ? <AutomaticPlan d={d} /> : open ? <ManualPlan d={d} /> : null}
      {open && d.mode === "automatic" ? <AccountDeletionProcess requestRowId={d.id} requestedAt={d.requestedAt} displayName={d.displayName} retry={d.status === "processing"} /> : null}
      {open && d.mode === "manual" ? <AccountDeletionManualDone requestRowId={d.id} requestedAt={d.requestedAt} displayName={d.displayName} loginActive={d.login === "active"} /> : null}
    </div>
  );
}
