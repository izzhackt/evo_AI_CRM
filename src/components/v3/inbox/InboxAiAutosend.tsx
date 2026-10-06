"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Icon } from "@/components/icons";
import {
  AI_AUTOSEND_COPY,
  aiAutosendChatLine,
  normalizeAiAutosendChat,
  type AiAutosendChat,
} from "@/lib/v3/ai-agent-autosend";

/**
 * «Автоответчик в этом чате» — полоса окна ИИ под «Что ИИ знает о клиенте»
 * (план ИИ-агента §11, §12.1; P4). Есть только когда автоответчик включён в
 * организации: выключенный не занимает место. Переключатель исключает чат
 * (`PUT …/autosend`, Q9 — любой сотрудник, которому виден чат) или
 * возвращает его; строка под ним говорит, что будет ночью. Ничего не
 * отправляет. Сбой чтения — «Не удалось загрузить · Повторить»; отказ — молча.
 */
type Load =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "hidden" }>
  | Readonly<{ kind: "ready"; chat: AiAutosendChat; serverOn: boolean }>;

const FINAL_STATUSES = new Set([400, 401, 403, 404]);

async function readChat(conversationId: string, signal?: AbortSignal): Promise<Exclude<Load, { kind: "loading" }>> {
  try {
    const response = await fetch(`/api/v3/ai-agent/conversations/${conversationId}/autosend`, {
      cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal,
    });
    if (!response.ok) return { kind: FINAL_STATUSES.has(response.status) ? "hidden" : "failed" };
    const body = await response.json() as { chat?: unknown; serverOn?: unknown };
    const chat = normalizeAiAutosendChat(body.chat);
    return chat.enabled ? { kind: "ready", chat, serverOn: body.serverOn === true } : { kind: "hidden" };
  } catch {
    return { kind: "failed" };
  }
}

export function InboxAiAutosend({ conversationId }: Readonly<{ conversationId: string }>) {
  const id = useId();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /** Id записи: тот же при неизвестном итоге (повтор вернёт прежнюю квитанцию). */
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void readChat(conversationId, controller.signal).then((result) => {
      if (!controller.signal.aborted) setLoad(result);
    });
    return () => controller.abort();
  }, [conversationId]);

  const retry = useCallback(() => {
    setLoad({ kind: "loading" });
    void readChat(conversationId).then(setLoad);
  }, [conversationId]);

  async function toggle(chat: AiAutosendChat) {
    if (working) return;
    setWorking(true);
    setFailure(null);
    const excluded = !chat.excluded;
    requestId.current ??= crypto.randomUUID();
    let outcome: "saved" | "forbidden" | "final" | "unknown" = "unknown";
    try {
      const response = await fetch(`/api/v3/ai-agent/conversations/${conversationId}/autosend`, {
        method: "PUT",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ requestId: requestId.current, excluded }),
      });
      outcome = response.ok ? "saved" : response.status === 403 ? "forbidden" : response.status >= 500 ? "unknown" : "final";
    } catch {
      outcome = "unknown";
    }
    if (outcome !== "unknown") requestId.current = null;
    setWorking(false);
    if (outcome === "saved") {
      setLoad((current) => (current.kind === "ready" ? { ...current, chat: { ...current.chat, excluded } } : current));
      // Чип «Ночью отвечает автоответчик» в шапке — из чтения страницы.
      router.refresh();
      return;
    }
    setFailure(outcome === "forbidden" ? "Нет права менять автоответчик в этом чате." : "Не удалось сохранить — повторите.");
  }

  if (load.kind === "hidden" || load.kind === "loading") return null;
  if (load.kind === "failed") {
    return (
      <div className="v3-ai-autosend" data-testid="v3-ai-autosend-chat" data-state="failed">
        <Icon name="moon" size={16} className="shrink-0 text-fg-3" />
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 t-meta text-fg-2" role="alert">
          {AI_AUTOSEND_COPY.chatToggle}: не удалось загрузить
          <span aria-hidden="true">·</span>
          <button type="button" className="v3-ai-link v3-ai-memory-inline t-meta" onClick={retry}>Повторить</button>
        </p>
      </div>
    );
  }

  const { chat, serverOn } = load;
  const on = !chat.excluded;
  return (
    <div className="v3-ai-autosend" data-testid="v3-ai-autosend-chat" data-state={on ? "on" : "off"}>
      <Icon name="moon" size={16} className="shrink-0 text-fg-2" />
      <span className="min-w-0 flex-1">
        <span id={`${id}-label`} className="block t-label text-fg">{AI_AUTOSEND_COPY.chatToggle}</span>
        <span id={`${id}-line`} className="block t-meta text-fg-2" data-testid="v3-ai-autosend-chat-line">
          {aiAutosendChatLine(chat, serverOn)}
        </span>
        {failure ? <span className="block t-meta text-danger" role="alert">{failure}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-line`}
        aria-disabled={working || undefined}
        aria-busy={working || undefined}
        onClick={() => void toggle(chat)}
        className="v3-switch"
        data-testid="v3-ai-autosend-switch"
      >
        <span className="v3-switch-track" aria-hidden="true" />
      </button>
    </div>
  );
}
