"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import {
  AI_MEMORY_COPY,
  AI_MEMORY_SETTINGS_HREF,
  AI_MEMORY_SUMMARY_CLAMP_FROM,
  aiLeadLine,
  aiMemoryHint,
  aiMemoryMeta,
  aiMemoryState,
  normalizeAiMemoryView,
  type AiMemoryView,
} from "@/lib/v3/ai-agent-memory";

/**
 * «Что ИИ знает о клиенте» — свёрнутый блок наверху окна ИИ (план ИИ-агента
 * §9, §12.1; P3). Читается при открытии окна (`GET …/memory`, без агента и
 * Gemini) и ответу не мешает: сбой — строка «Не удалось загрузить · Повторить».
 * Свёрнуто — заголовок и интерес одной строкой; раскрыто — «Интерес»,
 * «Сводка» (шесть строк и «Показать всё»), карточка лида — ровно та, что
 * видит модель, — и «Забыть сводку» с подтверждением в строке.
 */
type Load =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "ready"; view: AiMemoryView }>;

type Note = Readonly<{ tone: "ok" | "danger"; text: string }>;

async function readMemory(conversationId: string, signal?: AbortSignal): Promise<AiMemoryView | null> {
  try {
    const response = await fetch(`/api/v3/ai-agent/conversations/${conversationId}/memory`, {
      cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal,
    });
    if (!response.ok) return null;
    const body = await response.json() as { memory?: unknown };
    return normalizeAiMemoryView(body.memory);
  } catch {
    return null;
  }
}

export function InboxAiMemory({ conversationId }: Readonly<{ conversationId: string }>) {
  const id = useId();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [whole, setWhole] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  /** Id запроса «Забыть»: тот же при неизвестном итоге (повтор вернёт прежнюю квитанцию). */
  const requestId = useRef<string | null>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const forgetRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const read = useCallback(async () => {
    const view = await readMemory(conversationId);
    setLoad(view ? { kind: "ready", view } : { kind: "failed" });
  }, [conversationId]);

  // Блок монтируется вместе с раскрытым окном: одно чтение на открытие.
  useEffect(() => {
    const controller = new AbortController();
    void readMemory(conversationId, controller.signal).then((view) => {
      if (!controller.signal.aborted) setLoad(view ? { kind: "ready", view } : { kind: "failed" });
    });
    return () => controller.abort();
  }, [conversationId]);

  function retry() {
    setLoad({ kind: "loading" });
    void read();
  }

  function askForget() {
    setNote(null);
    setConfirming(true);
    requestAnimationFrame(() => confirmRef.current?.focus());
  }
  function cancelForget() {
    setConfirming(false);
    requestAnimationFrame(() => forgetRef.current?.focus());
  }

  async function forget() {
    if (working) return;
    setWorking(true);
    setNote(null);
    requestId.current ??= crypto.randomUUID();
    let outcome: "cleared" | "forbidden" | "final" | "unknown" = "unknown";
    try {
      const response = await fetch(`/api/v3/ai-agent/conversations/${conversationId}/memory`, {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ requestId: requestId.current }),
      });
      outcome = response.ok ? "cleared" : response.status === 403 ? "forbidden" : response.status >= 500 ? "unknown" : "final";
    } catch {
      outcome = "unknown";
    }
    // Записано или окончательно отклонено — следующий раз новый id; неизвестно — тот же.
    if (outcome !== "unknown") requestId.current = null;
    setWorking(false);
    if (outcome === "cleared") {
      setConfirming(false);
      setNote({ tone: "ok", text: AI_MEMORY_COPY.forgotten });
      await read();
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setNote({ tone: "danger", text: outcome === "forbidden" ? AI_MEMORY_COPY.forgetForbidden : AI_MEMORY_COPY.forgetFailed });
  }

  if (load.kind === "failed") {
    return (
      <div className="v3-ai-memory" data-testid="v3-ai-memory" data-state="failed">
        <div className="v3-ai-memory-head">
          <Icon name="alert" size={16} className="shrink-0 text-fg-3" />
          <span className="min-w-0 flex-1">
            <span className="block t-label text-fg">{AI_MEMORY_COPY.title}</span>
            <span className="flex flex-wrap items-center gap-x-1.5 t-meta text-fg-2" role="alert">
              {AI_MEMORY_COPY.failed}
              <span aria-hidden="true">·</span>
              <button type="button" className="v3-ai-link v3-ai-memory-inline t-meta" onClick={retry}>{AI_MEMORY_COPY.retry}</button>
            </span>
          </span>
        </div>
      </div>
    );
  }

  const view = load.kind === "ready" ? load.view : null;
  const state = view ? aiMemoryState(view) : null;
  const memory = view?.memory ?? null;
  const summary = memory?.summary ?? null;
  const clampable = (summary?.length ?? 0) > AI_MEMORY_SUMMARY_CLAMP_FROM || (summary?.split("\n").length ?? 0) > 6;
  const meta = memory ? aiMemoryMeta(memory) : null;
  const canForget = !!memory && (!!memory.summary || !!memory.interest);

  return (
    <details className="v3-ai-memory" data-testid="v3-ai-memory" data-state={state ?? "loading"}>
      <summary ref={summaryRef} className="v3-ai-memory-head" aria-busy={load.kind === "loading" || undefined}>
        <Icon name="chevron-right" size={16} className="v3-ai-memory-chevron shrink-0 text-fg-2" />
        <span className="min-w-0 flex-1">
          <span className="block t-label text-fg">{AI_MEMORY_COPY.title}</span>
          <span
            className={`block truncate t-meta ${view?.memory?.interest && view.enabled ? "text-fg-2" : "text-fg-3"}`}
            data-testid="v3-ai-memory-hint"
          >
            {view ? aiMemoryHint(view) : "Загружаю…"}
          </span>
        </span>
      </summary>

      <div className="v3-ai-memory-body">
        {!view ? (
          <div className="space-y-2 py-1" aria-hidden="true">
            <div className="v3-ai-skeleton w-[70%]" />
            <div className="v3-ai-skeleton w-[88%]" />
          </div>
        ) : (
          <>
            {state === "off" ? (
              <div className="flex flex-wrap items-center gap-x-3" data-testid="v3-ai-memory-off">
                <p className="t-body-compact text-fg-2">{AI_MEMORY_COPY.off}</p>
                {view.canManage ? (
                  <Link href={AI_MEMORY_SETTINGS_HREF} className="v3-ai-link t-label">
                    {AI_MEMORY_COPY.enable}<span className="sr-only"> память о клиенте в «Расходах»</span>
                  </Link>
                ) : null}
              </div>
            ) : null}
            <dl className="space-y-2.5">
              {state !== "off" ? (
                <>
                  <div>
                    <dt className="t-caption text-fg-3">Интерес</dt>
                    <dd className={`mt-0.5 break-words t-body-compact ${memory?.interest ? "text-fg" : "text-fg-2"}`} data-testid="v3-ai-memory-interest">
                      {memory?.interest ?? AI_MEMORY_COPY.noInterest}
                    </dd>
                  </div>
                  <div>
                    <dt className="t-caption text-fg-3">Сводка</dt>
                    {summary ? (
                      <dd className="mt-0.5">
                        <p
                          id={`${id}-summary`}
                          className="v3-ai-memory-summary whitespace-pre-wrap break-words t-body-compact text-fg"
                          data-clamped={(clampable && !whole) || undefined}
                          data-testid="v3-ai-memory-summary"
                        >
                          {summary}
                        </p>
                        {clampable ? (
                          <button
                            type="button"
                            className="v3-ai-link t-label"
                            aria-expanded={whole}
                            aria-controls={`${id}-summary`}
                            onClick={() => setWhole((value) => !value)}
                          >
                            {whole ? "Свернуть" : "Показать всё"}
                          </button>
                        ) : null}
                      </dd>
                    ) : (
                      <dd className="mt-0.5 t-body-compact text-fg-2" data-testid="v3-ai-memory-summary-state">
                        {state === "due" ? AI_MEMORY_COPY.due : AI_MEMORY_COPY.short}
                      </dd>
                    )}
                  </div>
                </>
              ) : null}
              <div>
                <dt className="t-caption text-fg-3">Карточка лида</dt>
                <dd className={`mt-0.5 break-words t-body-compact ${view.lead ? "text-fg" : "text-fg-2"}`} data-testid="v3-ai-memory-lead">
                  {aiLeadLine(view.lead)}
                </dd>
              </div>
            </dl>

            {meta || canForget ? (
              <div className="v3-ai-memory-foot">
                {meta ? <p className="t-meta text-fg-3" data-testid="v3-ai-memory-meta">{meta}</p> : null}
                {canForget && !confirming ? (
                  <button ref={forgetRef} type="button" className="v3-ai-link t-label" onClick={askForget}>
                    {AI_MEMORY_COPY.forget}
                  </button>
                ) : null}
              </div>
            ) : null}

            {canForget && confirming ? (
              <div className="v3-ai-memory-confirm" role="group" aria-labelledby={`${id}-confirm`} data-testid="v3-ai-memory-confirm">
                <p id={`${id}-confirm`} className="t-body-compact text-fg">{AI_MEMORY_COPY.forgetConfirm}</p>
                <div className="flex flex-wrap items-center gap-x-4">
                  <button
                    ref={confirmRef}
                    type="button"
                    className="v3-ai-button"
                    aria-disabled={working || undefined}
                    onClick={() => void forget()}
                  >
                    {working ? "Забываю…" : AI_MEMORY_COPY.forget}
                  </button>
                  <button type="button" className="v3-ai-link t-label" onClick={cancelForget}>Отмена</button>
                </div>
              </div>
            ) : null}

            {note ? (
              <p
                className={`t-body-compact ${note.tone === "ok" ? "text-fg-2" : "text-danger"}`}
                role={note.tone === "ok" ? "status" : "alert"}
                data-testid="v3-ai-memory-note"
              >
                {note.text}
              </p>
            ) : null}
          </>
        )}
      </div>
    </details>
  );
}
