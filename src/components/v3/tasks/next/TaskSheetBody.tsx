"use client";

import Link from "next/link";

import { HelpTip, KeyFacts, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { DIAL_TOUCH_HINT } from "@/lib/v3/telephony-dial";
import { taskStatus } from "@/lib/v3/wording";

import { queueDue } from "../../queue/due-bucket";
import { DialButton } from "../../telephony/DialButton";
import { TaskSheetComplete, TaskSheetMove } from "./TaskSheetForms";
import type { TaskSheetData } from "./task-sheet-data";
import { useTaskSheetCommands } from "./useTaskSheetCommands";

const SECTION = "grid gap-2 border-t border-border pt-4";
const H3 = "t-item text-fg";

/**
 * Содержимое панели задачи: срок, исполнитель и состояние (`KeyFacts`), клиент с «Позвонить», завершение, описание,
 * прежние результаты, ссылки и свёрнутое «Перенести или передать». Формы и действия — прежние (`useTaskSheetCommands`);
 * пояснение к «Позвонить» уехало за «?». Просмотр роли (`readOnly`) команд не получает.
 */
export function TaskSheetBody({ data, moveOpen, readOnly }: Readonly<{ data: TaskSheetData; moveOpen: boolean; readOnly: boolean }>) {
  const commands = useTaskSheetCommands(data);
  const status = data.kind === "staff" ? data.task.status : data.task.state;
  const isDone = status === "done" || status === "cancelled";
  const due = queueDue(data.task, new Date(data.nowIso), !isDone);
  const exception = status === "blocked" || isDone ? taskStatus(status) : null;
  const description = data.kind === "staff" ? data.task.description : data.task.details;
  const lead = data.kind === "staff" && !readOnly ? data.extra.lead : null;
  const extra = data.kind === "staff" ? data.extra : null;
  return (
    <div className="grid gap-5" data-testid="v3-task-detail-panel">
      <KeyFacts columns={2} facts={[
        { label: "Срок", value: due
          ? <><time dateTime={due.dateTime} className={`font-mono tabular-nums ${due.overdue ? "text-danger" : ""}`}>{due.text}</time>{due.word ? <span className={due.overdue ? "text-danger" : "text-fg-2"}> · {due.word}</span> : null}</>
          : <span className="text-fg-2">Без срока</span> },
        { label: "Исполнитель", value: data.task.assigneeDisplayName },
        { label: "Состояние", value: exception ? <StatusBadge label={exception} tone={status === "blocked" ? "warn" : "neutral"} /> : null },
      ]} />
      {lead ? (
        <section className={SECTION} aria-label="Клиент" data-testid="v3-task-lead">
          <div className="flex items-center gap-2">
            <h3 className={H3}>Клиент: <span className="break-words">{lead.name}</span></h3>
            {!isDone && lead.mapped ? <HelpTip label="Пояснение: Позвонить">{DIAL_TOUCH_HINT}</HelpTip> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isDone ? <DialButton leadId={lead.leadId} mapped={lead.mapped} subject={lead.name} /> : null}
            <Button variant="link" asChild><Link href={lead.href}>Открыть карточку лида</Link></Button>
          </div>
        </section>
      ) : null}
      {!isDone && !readOnly ? <TaskSheetComplete data={data} commands={commands} /> : null}
      {description ? <section className={SECTION} aria-label="Описание"><h3 className={H3}>Описание</h3><p className="whitespace-pre-wrap break-words t-body-compact text-fg-2">{description}</p></section> : null}
      {extra && (extra.outcomes.length || extra.outcomesUnavailable) ? (
        <section className={SECTION} aria-label="Результаты">
          <h3 className={H3}>Результаты</h3>
          {extra.outcomes.map((outcome) => (
            <article key={outcome.requestId} className="border-t border-border pt-2 first-of-type:border-t-0 first-of-type:pt-0">
              <p className="whitespace-pre-wrap break-words t-body-compact text-fg">{outcome.note}</p>
              <p className="mt-1 t-meta text-fg-2">{outcome.author} · {new Date(outcome.createdAt).toLocaleDateString("ru-RU", { timeZone: "Asia/Bishkek" })}</p>
            </article>
          ))}
          {extra.outcomesUnavailable ? <p className="t-body-compact text-fg-3">Не удалось загрузить связь с лидом и результаты. Обновите страницу.</p> : null}
        </section>
      ) : null}
      <div className="flex flex-wrap gap-x-3">
        {data.kind === "case" ? <Button variant="link" asChild><Link href={`/v3/messages?case=${data.caseId}&attach=case_task:${data.task.id}`}>Обсудить</Link></Button> : null}
        {extra?.leadHref ? <Button variant="link" asChild><Link href={extra.leadHref}>{extra.lead ? "Все задачи по лиду" : "Открыть связанного лида"}</Link></Button> : null}
        {extra?.sourceHref ? <Button variant="link" asChild><Link href={extra.sourceHref}>Открыть исходное обсуждение</Link></Button> : null}
      </div>
      {extra && !extra.sourceHref && extra.sourceUnavailable ? <p className="t-body-compact text-fg-3">Обсуждение недоступно.</p> : null}
      {!readOnly ? <TaskSheetMove data={data} commands={commands} open={moveOpen} /> : null}
      {commands.notice ? <p role="status" className="t-body-compact text-ok">{commands.notice}</p> : null}
      {commands.error ? <p role="alert" className="t-body-compact text-danger">{commands.error}</p> : null}
    </div>
  );
}
