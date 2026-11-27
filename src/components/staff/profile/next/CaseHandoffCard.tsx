"use client";

import { useState } from "react";

import type { HandoffNote } from "@/lib/agent-suggestions-contract";
import { agentSuggestionWords as words } from "@/lib/v3/wording";

import { QUEUE_SECONDARY } from "../../queue/queue-buttons";
import { useAgentWork } from "../use-agent-work";
import { NamedCard } from "./NamedCard";

function momentOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" }).format(date);
}

/**
 * «Передача» в «Обзоре» дела (миграция 383, решение владельца 28.11.2026): одна страница, которую агент-куратор собрал из
 * досье дела и сохранил заметкой дела «Передача дела» (отдельного хранилища нет, клиенту и студенту она не видна). Показывает
 * последнюю такую заметку; «Собрать передачу» поручает агенту собрать страницу, «Собрать заново» — собрать свежую. Пока
 * агент работает — «Агент собирает страницу…», потом страница перечитывается сама.
 */
export function CaseHandoffCard({
  studentCaseId,
  note,
  unavailable,
  editable,
  requestId,
}: Readonly<{
  studentCaseId: string;
  note: HandoffNote | null;
  unavailable: boolean;
  editable: boolean;
  requestId: string;
}>) {
  const work = useAgentWork({ kind: "handoff", studentCaseId, requestId })
  // Какая страница была до нажатия: если запуск кончился, а новой заметки нет, говорим об этом.
  const [before, setBefore] = useState<string | null>(null);;
  const action = editable ? (
    work.busy ? (
      <p role="status" className="inline-flex min-h-11 items-center t-body-compact text-fg-2" data-testid="v3-case-handoff-thinking">{work.phase.kind === "starting" ? words.starting : words.handoffThinking}</p>
    ) : (
      <button type="button" onClick={() => { setBefore(note?.noteId ?? ""); void work.ask(); }} className={QUEUE_SECONDARY} data-testid="v3-case-handoff-build">
        {note ? words.handoffRebuild : words.handoffBuild}
      </button>
    )
  ) : null;
  return (
    <NamedCard title={words.handoffTitle} id="case-handoff" titleId="case-handoff-title" testId="v3-case-handoff" wrapActions actions={action}>
      {unavailable ? (
        <p role="alert" className="t-body-compact text-danger" data-testid="v3-case-handoff-unread">{words.handoffUnavailable}</p>
      ) : note ? (
        <div className="flex flex-col gap-3" data-testid="v3-case-handoff-page">
          <dl className="flex flex-col gap-2">
            {note.lines.map((line, index) => (
              <div key={`${index}:${line.label ?? ""}`} className={line.sub ? "ms-4 min-w-0" : "min-w-0"}>
                {line.label ? <dt className="t-caption text-fg-2">{line.label}</dt> : null}
                <dd className="min-w-0 whitespace-pre-line break-words t-body-compact text-fg">{line.text}</dd>
              </div>
            ))}
          </dl>
          <p className="t-caption text-fg-3">
            {words.handoffFrom}: {note.agentTitle}, {momentOf(note.createdAt)}. {words.handoffInternal}
          </p>
        </div>
      ) : (
        <p className="t-body-compact text-fg-3" data-testid="v3-case-handoff-empty">{words.handoffEmpty}</p>
      )}
      {work.phase.kind === "failed" ? <p role="alert" className="mt-2 t-body-compact text-danger" data-testid="v3-case-handoff-failed">{work.phase.message}</p> : null}
      {work.phase.kind === "lost" ? <p className="mt-2 t-body-compact text-fg-2">{words.pollLost}</p> : null}
      {work.phase.kind === "finished" && !work.refreshing && before !== null && before === (note?.noteId ?? "")
        ? <p role="status" className="mt-2 t-body-compact text-fg-2" data-testid="v3-case-handoff-nonote">{words.handoffNoNote}</p> : null}
      {work.phase.kind === "slow" ? <p className="mt-2 t-body-compact text-fg-2">{words.stillWorking}</p> : null}
    </NamedCard>
  );
}
