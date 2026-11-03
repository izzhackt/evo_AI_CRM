"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import { answerTaskTitle } from "@/lib/v3/ai-agents-view";

import { openTaskComposer } from "../tasks/task-composer-context";

/** Предел описания у диалога «Новая задача» (его поле — `maxLength` 10000). */
const TASK_DESCRIPTION_LIMIT = 10_000;
/** Сколько слово «Скопировано» держится на кнопке. */
const COPIED_MS = 2000;

const ACTION = "inline-flex min-h-11 items-center gap-1.5 rounded-ctl px-2.5 t-label text-fg-2 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/**
 * Действия под каждым ответом агента: «Скопировать» (текст ответа как Markdown)
 * и «Сделать задачей» — единственный диалог создания задачи (`openTaskComposer`)
 * с названием из первой строки ответа и самим ответом в описании. Диалога нет
 * (нет права, страницы без оболочки) — кнопки нет: уводить человека на другую
 * страницу и терять текст нельзя. Итог копирования говорится словом на кнопке и
 * вслух (`role="status"`), а не только сменой значка.
 */
export function AnswerActions({
  text,
  allowTask,
  meta,
}: Readonly<{
  text: string;
  /** Право создавать задачи; без него и без диалога оболочки кнопки «Сделать задачей» нет. */
  allowTask: boolean;
  /** «12 с · 0,11 $ · 5 шагов» — только под последним ответом закончившегося запуска. */
  meta?: string | null;
}>) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const [taskGone, setTaskGone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copyText() {
    let next: "done" | "failed" = "done";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed";
    }
    setCopy(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy("idle"), COPIED_MS);
  }

  function makeTask(trigger: HTMLElement) {
    const title = answerTaskTitle(text) || "Задача по ответу агента";
    const description = text.length > TASK_DESCRIPTION_LIMIT ? `${text.slice(0, TASK_DESCRIPTION_LIMIT - 1)}…` : text;
    if (!openTaskComposer({ title, description }, trigger)) setTaskGone(true);
  }

  const word = copy === "done" ? "Скопировано" : copy === "failed" ? "Не скопировалось" : "Скопировать";
  return (
    <div className="-ms-2.5 flex flex-wrap items-center gap-x-1">
      <button type="button" className={ACTION} onClick={() => void copyText()} data-testid="v3-aia-copy">
        <Icon name={copy === "done" ? "check" : "copy"} size={16} className="shrink-0" />
        <span className={copy === "failed" ? "text-danger" : undefined}>{word}</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">{copy === "idle" ? "" : word}</span>
      {allowTask && !taskGone ? (
        <button type="button" className={ACTION} onClick={(event) => makeTask(event.currentTarget)} data-testid="v3-aia-make-task">
          <Icon name="check-square" size={16} className="shrink-0" />
          Сделать задачей
        </button>
      ) : null}
      {meta ? <span className="ms-2.5 t-meta tabular-nums text-fg-3" data-testid="v3-aia-run-meta">{meta}</span> : null}
    </div>
  );
}
