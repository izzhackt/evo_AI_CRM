"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";

import { TaskSheetBody } from "./TaskSheetBody";
import type { TaskSheetData } from "./task-sheet-data";

export type { TaskSheetData } from "./task-sheet-data";

/**
 * Панель задачи. Открыта ли она, решает адрес (`?task=`): страница читает задачу и отдаёт `sheet`, закрытие ведёт
 * на адрес списка (`closeHref`) с теми же видом и фильтрами. Закрывается сразу, не дожидаясь ответа сервера
 * (`dismissed`: именно эта выдача сервера, так что повторное открытие той же задачи открывает панель снова). Когда сервер
 * подтвердил закрытие (`sheet` стал null), отметка снимается: «Назад» браузера возвращает закэшированную выдачу —
 * тот же объект, — и панель по адресу `?task=` открывается снова. Последняя открытая задача остаётся в состоянии, пока
 * панель уезжает, — пустая шапка не мигает.
 * Фокус возвращается на строку, откуда панель открыли (`DetailSheet`).
 */
export function TaskSheetHost({ sheet, closeHref, moveOpen, readOnly }: Readonly<{ sheet: TaskSheetData | null; closeHref: string; moveOpen: boolean; readOnly: boolean }>) {
  const router = useRouter();
  const [kept, setKept] = useState(sheet);
  const [dismissed, setDismissed] = useState<TaskSheetData | null>(null);
  if (sheet && sheet !== kept) setKept(sheet);
  if (sheet === null && dismissed !== null) setDismissed(null);
  const current = sheet ?? kept;
  if (!current) return null;
  const context = current.kind === "case"
    ? `${current.task.person ?? "Студент"}${current.task.caseState === "closed" ? " · дело закрыто" : ""}`
    : `Рабочая задача${current.task.sourceMessageId ? " · из чата" : ""}`;
  return (
    <DetailSheet
      open={sheet !== null && dismissed !== sheet}
      onOpenChange={(next) => {
        if (next) return;
        setDismissed(sheet);
        router.push(closeHref, { scroll: false });
      }}
      title={current.task.title}
      description={context}
      footer={current.kind === "case" ? <Button variant="outline" asChild><Link href={`/v3/profile?case=${encodeURIComponent(current.caseId)}`}>Открыть дело</Link></Button> : undefined}
    >
      <TaskSheetBody key={current.key} data={current} moveOpen={moveOpen} readOnly={readOnly} />
    </DetailSheet>
  );
}
