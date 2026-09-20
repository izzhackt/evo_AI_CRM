"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Pill } from "@/components/v3/Pill";
import { submittedDate } from "@/components/v3/admissions/StudentApplications";
import { handlePortalConsultationAction } from "@/lib/platform-portal-consultation-actions";
import type { PortalConsultationQueue, PortalConsultationRow } from "@/lib/v3/requests-source";
import { portalConsultationStatus } from "@/lib/v3/wording";

/**
 * «Кабинет: консультации» (PORT-5b, миграция 197) — аддитивная секция экрана
 * «Заявки»: запросы консультации из студенческого кабинета. Контекст строки —
 * имя студента, выбранный вуз (если был), заметка и дата; действие одно —
 * «Обработано». PT409 показывается честно: запись уже обработали, список
 * обновится.
 */

function HandleButton({ row }: { row: PortalConsultationRow }) {
  const [outcome, setOutcome] = useState<"idle" | "conflict" | "failed">("idle");
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        className="inline-flex min-h-11 items-center rounded-nav border border-control-edge px-3 text-sm font-medium text-fg hover:bg-surface-2 disabled:opacity-60"
        onClick={() => {
          setOutcome("idle");
          startTransition(async () => {
            const result = await handlePortalConsultationAction(row.id, row.status);
            if (result.status === "handled") return;
            setOutcome(result.status === "conflict" ? "conflict" : "failed");
          });
        }}
      >
        Обработано
      </button>
      {outcome === "conflict" ? (
        <p role="alert" className="text-sm text-fg-2">
          Запрос уже обработан. <Link href="/v3/requests?source=portal_consultation" className="font-semibold text-accent hover:underline">Обновить список</Link>
        </p>
      ) : null}
      {outcome === "failed" ? (
        <p role="alert" className="text-sm text-fg-2">Не удалось отметить. Повторите.</p>
      ) : null}
    </div>
  );
}

export function PortalConsultations({
  queue,
  readOnly,
}: {
  queue: PortalConsultationQueue;
  readOnly: boolean;
}) {
  return (
    <section aria-label="Кабинет: консультации" className="space-y-4">
      <p className="text-sm text-fg-2">Открытых запросов: {queue.openCount}</p>
      {queue.items.length === 0 ? (
        <p className="text-sm text-fg-2">Запросов на консультацию пока нет.</p>
      ) : (
        <ul className="space-y-4">
          {queue.items.map((row) => (
            <li key={row.id} className="min-w-0 rounded-card border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-fg">{row.studentName}</span>
                <span className="flex items-center gap-2 text-xs text-fg-2">
                  <Pill tone={row.status === "requested" ? "info" : "neutral"}>
                    {portalConsultationStatus(row.status) ?? "статус недоступен"}
                  </Pill>
                  {submittedDate(row.requestedAt)}
                </span>
              </div>
              {row.institutionName !== null ? (
                <p className="mt-2 text-sm text-fg-2">Университет: {row.institutionName}</p>
              ) : null}
              {row.note !== null ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{row.note}</p>
              ) : null}
              {row.status === "handled" && row.handledAt !== null ? (
                <p className="mt-2 text-sm text-fg-2">
                  Обработано {submittedDate(row.handledAt)}
                  {row.handledByName !== null ? ` · ${row.handledByName}` : ""}
                </p>
              ) : null}
              {row.status === "requested" ? (
                readOnly ? (
                  <p className="mt-3 text-sm text-fg-2">В режиме просмотра действия недоступны.</p>
                ) : (
                  <HandleButton row={row} />
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {queue.nextOffset !== null ? (
        <p className="text-sm text-fg-2">
          Показаны первые записи.{" "}
          <Link
            href={`/v3/requests?source=portal_consultation&offset=${queue.nextOffset}`}
            className="font-semibold text-accent hover:underline"
          >
            Следующая страница
          </Link>
        </p>
      ) : null}
    </section>
  );
}
