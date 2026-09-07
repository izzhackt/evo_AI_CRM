"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  createCaseNoteAction,
  type PlatformCaseNoteActionState,
} from "@/lib/platform-case-note-actions";
import { isPlatformCaseNoteBodyWithinCodePointLimit } from "@/lib/platform-case-note-contract";
import type { ProfileNotesSnapshot } from "./types";

const NOTE_TIME = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bishkek",
});

const STATUS_COPY: Readonly<
  Record<Exclude<PlatformCaseNoteActionState["status"], "idle">, string>
> = Object.freeze({
  saved: "Заметка сохранена.",
  invalid: "Проверьте текст заметки и попробуйте снова.",
  forbidden: "Нет доступа к заметкам этого профиля.",
  request_conflict: "Этот запрос уже использован. Повторите сохранение.",
  unavailable: "Заметки временно недоступны.",
});

function formatNoteTime(value: string): string {
  return NOTE_TIME.format(new Date(value));
}

export function ProfileNotes({
  notes,
  requestId,
  olderHref,
  latestHref,
}: {
  notes: ProfileNotesSnapshot;
  requestId: string;
  olderHref: string | null;
  latestHref: string | null;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const acceptedBodyRef = useRef("");
  const initialState: PlatformCaseNoteActionState = Object.freeze({
    status: "idle",
    requestId,
    caseNoteId: null,
    createdAt: null,
  });
  const [state, action, pending] = useActionState(
    createCaseNoteAction,
    initialState,
  );
  const [lengthRejected, setLengthRejected] = useState(false);

  useEffect(() => {
    if (state.status === "saved") {
      acceptedBodyRef.current = "";
      formRef.current?.reset();
    }
  }, [state.status, state.caseNoteId]);

  return (
    <section
      aria-labelledby="profile-notes-title"
      className="rounded-card border border-border bg-surface"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id="profile-notes-title" className="text-sm font-semibold text-fg">
          Заметки
        </h2>
        <p className="mt-0.5 text-2xs text-fg-3">
          Исправление записывается новой заметкой; сохранённые записи не редактируются.
        </p>
      </div>

      <form ref={formRef} action={action} className="space-y-2 border-b border-border p-4">
        <input type="hidden" name="lead_id" value={notes.subject.leadId ?? ""} />
        <input
          type="hidden"
          name="student_case_id"
          value={notes.subject.studentCaseId ?? ""}
        />
        <input type="hidden" name="request_id" value={state.requestId} />
        <label htmlFor="profile-note-body" className="block text-xs font-semibold text-fg-2">
          Новая заметка
        </label>
        <textarea
          id="profile-note-body"
          name="body"
          required
          rows={3}
          disabled={pending}
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
          aria-describedby={
            lengthRejected ? "profile-note-body-length-error" : undefined
          }
          className="w-full resize-y rounded-ctl border border-control-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent disabled:opacity-60"
        />
        {lengthRejected ? (
          <p
            id="profile-note-body-length-error"
            role="alert"
            className="text-xs text-danger"
          >
            Изменение не применено: заметка не может превышать 4000 символов.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs text-fg-3" aria-live="polite">
            {state.status === "idle" ? "До 4000 знаков." : STATUS_COPY[state.status]}
          </p>
          <button
            type="submit"
            disabled={pending || lengthRejected}
            className="min-h-10 rounded-ctl bg-accent px-3 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Сохраняем…" : "Добавить заметку"}
          </button>
        </div>
      </form>

      {notes.rows.length > 0 ? (
        <ol className="divide-y divide-border">
          {notes.rows.map((note, index) => (
            <li key={`${note.createdAt}:${index}`} className="px-4 py-3">
              <p className="whitespace-pre-wrap break-words text-sm text-fg">{note.body}</p>
              <p className="mt-1 text-2xs text-fg-3">
                <span>{note.authorDisplayName}</span>
                {" · "}
                <time dateTime={note.createdAt}>{formatNoteTime(note.createdAt)}</time>
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-4 py-5 text-sm text-fg-3">Заметок пока нет.</p>
      )}

      {olderHref || latestHref ? (
        <nav aria-label="Страницы заметок" className="flex items-center gap-4 border-t border-border px-4 py-3 text-xs font-semibold">
          {latestHref ? (
            <Link href={latestHref} prefetch={false} className="text-accent hover:underline">
              К последним
            </Link>
          ) : null}
          {olderHref ? (
            <Link href={olderHref} prefetch={false} className="text-accent hover:underline">
              Ранее
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
