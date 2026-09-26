"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import type { CaseNextActionReceipt, StudentCaseQueueRow } from "@/lib/platform-student-case-queue-contract";

import { queueDue } from "../queue/due-bucket";
import { useAnchoredPopover } from "../queue/useAnchoredPopover";
import { NextStepEditor } from "../students/NextStepEditor";
import type { NextStepAccess } from "../students/students-queue-view";

/** Текстовая кнопка факта: 44 px по высоте, подчёркнута — без красного она остаётся действием. */
const FACT_ACTION = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * «Следующий шаг» в строке фактов дела: текст и срок, а «Изменить» открывает
 * тот же редактор, что в «Быстром просмотре» (#1059), в окне у своей кнопки
 * (popover API — верхний слой, прокрутка его не обрежет). Права — те же:
 * `nextStepAccess`; запись проверяет `set_case_next_action_v1`. После
 * сохранения строка берёт квитанцию сервера, а страница перечитывается.
 *
 * Без строки очереди (`row === null`) версии для записи нет: шаг показан из
 * самого дела, без срока и без редактора — «нет чтения — нет числа».
 */
export function CaseNextStep({
  row: initialRow,
  fallbackStep,
  access,
  today,
  nowIso,
  requestId,
}: Readonly<{
  row: StudentCaseQueueRow | null;
  fallbackStep: string | null;
  access: NextStepAccess;
  today: string;
  nowIso: string;
  requestId: string;
}>) {
  const router = useRouter();
  const titleId = useId();
  const popover = useAnchoredPopover("start");
  const [row, setRow] = useState(initialRow);
  // Страница перечитала дело (своё сохранение или чужое): новая версия побеждает местную копию.
  const [seenVersion, setSeenVersion] = useState(initialRow?.admissionsVersion ?? null);
  if ((initialRow?.admissionsVersion ?? null) !== seenVersion) {
    setSeenVersion(initialRow?.admissionsVersion ?? null);
    setRow(initialRow);
  }
  const step = row ? row.nextAction : fallbackStep;
  const due = row?.nextAction && row.nextActionDueOn
    ? queueDue({ dueOn: row.nextActionDueOn, dueAt: null }, new Date(nowIso), row.state === "active")
    : null;
  const editable = row !== null && access.kind === "edit";

  // Окно открылось — фокус в поле шага; закрылось — браузер вернёт его на «Изменить».
  useEffect(() => {
    const element = document.getElementById(popover.popoverId);
    if (!element) return;
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") element.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    };
    element.addEventListener("toggle", onToggle);
    return () => element.removeEventListener("toggle", onToggle);
  }, [popover.popoverId]);

  function onSaved(receipt: CaseNextActionReceipt) {
    setRow((current) => current && current.studentCaseId === receipt.studentCaseId ? {
      ...current,
      nextAction: receipt.nextAction,
      nextActionDueOn: receipt.nextActionDueOn,
      admissionsVersion: receipt.admissionsVersion,
    } : current);
    setSeenVersion(receipt.admissionsVersion);
    router.refresh();
  }

  return (
    <>
      <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 t-body-compact text-fg" data-testid="v3-case-next-step">
        {step ? <span className="min-w-0 break-words">{step}</span> : <span className="text-fg-2">Шаг не задан</span>}
        {due ? (
          <span className={due.overdue ? "text-danger" : "text-fg-2"}>
            <time dateTime={due.dateTime} className="font-mono tabular-nums">{due.text}</time>
            {due.word ? ` ${due.word}` : null}
          </span>
        ) : null}
        {editable ? (
          <button id={popover.triggerId} type="button" popoverTarget={popover.popoverId} style={popover.triggerStyle}
            aria-haspopup="dialog" className={FACT_ACTION}>
            {step ? "Изменить" : "Задать шаг"}
          </button>
        ) : null}
      </p>
      {/* У дела в работе причина бывает одна — просмотр роли; «закрыто» и «ожидает начала» уже названы в строке фактов. */}
      {access.kind === "read_only" && access.reason && row?.state === "active" ? <p className="t-meta text-fg-2">{access.reason}</p> : null}
      {editable && row ? (
        <div id={popover.popoverId} popover="auto" style={popover.popoverStyle} role="dialog" aria-labelledby={titleId}
          className="v3-anchored w-[min(28rem,calc(100vw-1rem))] rounded-ctl border border-border bg-surface p-4 text-fg shadow-evo-lg">
          <h2 id={titleId} className="t-section text-fg">Следующий шаг</h2>
          <div className="mt-3">
            <NextStepEditor key={row.studentCaseId} row={row} today={today} requestId={requestId} onSaved={onSaved} />
          </div>
        </div>
      ) : null}
    </>
  );
}
