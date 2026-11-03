"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  createCaseNoteAction,
  type PlatformCaseNoteActionState,
} from "@/lib/platform-case-note-actions";
import { isPlatformCaseNoteBodyWithinCodePointLimit } from "@/lib/platform-case-note-contract";

import { QUEUE_SECONDARY } from "../queue/queue-buttons";
import type { ProfileNotesSnapshot } from "./types";

const STATUS_COPY: Readonly<
  Record<Exclude<PlatformCaseNoteActionState["status"], "idle">, string>
> = Object.freeze({
  saved: "Заметка сохранена.",
  invalid: "Проверьте текст заметки и попробуйте снова.",
  forbidden: "Нет доступа к заметкам этого профиля.",
  request_conflict: "Этот запрос уже использован. Повторите сохранение.",
  unavailable: "Заметки временно недоступны.",
});

/**
 * Заметка ленты Lead 360 и Student 360 (Э4) в одну строку: то же действие
 * (`createCaseNoteAction`), тот же субъект и тот же предел 4000 знаков, что у
 * `ProfileNotes`. Поле растёт вниз по тексту само (`field-sizing: content`,
 * до 15rem); браузер без него оставляет ручку высоты. Ctrl/⌘+Enter
 * отправляет. Исправление — новой заметкой: записи не редактируются.
 */
export function LeadNoteComposer({
  subject,
  requestId,
}: Readonly<{
  subject: ProfileNotesSnapshot["subject"];
  requestId: string;
}>) {
  const formRef = useRef<HTMLFormElement>(null);
  const acceptedBodyRef = useRef("");
  const [state, action, pending] = useActionState(createCaseNoteAction, Object.freeze({
    status: "idle",
    requestId,
    caseNoteId: null,
    createdAt: null,
  }) as PlatformCaseNoteActionState);
  const [lengthRejected, setLengthRejected] = useState(false);

  useEffect(() => {
    if (state.status === "saved") {
      acceptedBodyRef.current = "";
      formRef.current?.reset();
    }
  }, [state.status, state.caseNoteId]);

  return (
    <form ref={formRef} action={action} className="space-y-1" data-testid="v3-lead-note-composer">
      <input type="hidden" name="lead_id" value={subject.leadId ?? ""} />
      <input type="hidden" name="student_case_id" value={subject.studentCaseId ?? ""} />
      <input type="hidden" name="request_id" value={state.requestId} />
      <div className="flex items-start gap-2">
        <label htmlFor="lead-note-body" className="sr-only">Новая заметка</label>
        <textarea
          id="lead-note-body"
          name="body"
          required
          rows={1}
          disabled={pending}
          placeholder="Новая заметка"
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (!isPlatformCaseNoteBodyWithinCodePointLimit(value)) {
              event.currentTarget.value = acceptedBodyRef.current;
              setLengthRejected(true);
              return;
            }
            acceptedBodyRef.current = value;
            setLengthRejected(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          aria-describedby={lengthRejected ? "lead-note-body-length-error" : undefined}
          className="min-h-11 min-w-0 flex-1 resize-y supports-[field-sizing:content]:max-h-60 supports-[field-sizing:content]:resize-none supports-[field-sizing:content]:field-sizing-content rounded-ctl border border-control-edge bg-surface px-3 py-2.5 t-body text-fg placeholder:text-fg-3 focus-visible:border-accent disabled:bg-surface-2 disabled:text-fg-3"
        />
        <button type="submit" disabled={pending || lengthRejected} className={QUEUE_SECONDARY}>
          {pending ? "Сохраняем…" : "Добавить заметку"}
        </button>
      </div>
      {lengthRejected ? (
        <p id="lead-note-body-length-error" role="alert" className="t-body-compact text-danger">
          Изменение не применено: заметка не может превышать 4000 символов.
        </p>
      ) : null}
      <p className="t-meta text-fg-3" aria-live="polite">
        {state.status === "idle" ? null : STATUS_COPY[state.status]}
      </p>
    </form>
  );
}
