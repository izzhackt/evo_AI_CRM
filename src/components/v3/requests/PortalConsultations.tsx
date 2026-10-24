"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { submittedDate } from "@/lib/student-application-presentation";
import { handlePortalConsultationAction } from "@/lib/platform-portal-consultation-actions";
import type { PortalConsultationRow } from "@/lib/v3/requests-source";

import { QUEUE_QUIET_LINK } from "../queue/QueueStates";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";

/**
 * «Консультации» в «Заявках» (PORT-5b, миграция 197): запросы консультации из
 * студенческого кабинета открываются в правой панели очереди. Действие одно —
 * «Отметить обработанной». PT409 показывается честно: запись уже обработали,
 * список обновится.
 */

function HandleButton({ row, refreshHref }: { row: PortalConsultationRow; refreshHref: string }) {
  const [outcome, setOutcome] = useState<"idle" | "conflict" | "failed">("idle");
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        className={QUEUE_SECONDARY}
        onClick={() => {
          setOutcome("idle");
          startTransition(async () => {
            const result = await handlePortalConsultationAction(row.id, row.status);
            if (result.status === "handled") return;
            setOutcome(result.status === "conflict" ? "conflict" : "failed");
          });
        }}
      >
        {pending ? "Отмечаем…" : "Отметить обработанной"}
      </button>
      {outcome === "conflict" ? (
        <p role="alert" className="t-body-compact text-fg-2">
          Запрос уже обработан. <Link href={refreshHref} className={QUEUE_QUIET_LINK}>Обновить список</Link>
        </p>
      ) : null}
      {outcome === "failed" ? (
        <p role="alert" className="t-body-compact text-fg-2">Не удалось отметить. Повторите.</p>
      ) : null}
    </div>
  );
}

/** Row details shared by the unified queue; existing command and status guard stay intact. */
export function PortalConsultationDetails({ row, readOnly, refreshHref }: {
  row: PortalConsultationRow; readOnly: boolean; refreshHref: string;
}) {
  return <div className="t-body-compact space-y-2 text-fg-2">
    {row.institutionName !== null ? <p className="break-words">Университет: {row.institutionName}</p> : null}
    {row.note !== null ? <p className="whitespace-pre-wrap break-words text-fg">{row.note}</p> : null}
    {row.status === "handled" && row.handledAt !== null ? <p>Обработано {submittedDate(row.handledAt)}{row.handledByName !== null ? ` · ${row.handledByName}` : ""}</p> : null}
    {row.status === "requested" ? readOnly ? <p>В режиме просмотра действия недоступны.</p>
      : <HandleButton row={row} refreshHref={refreshHref} /> : null}
  </div>;
}
