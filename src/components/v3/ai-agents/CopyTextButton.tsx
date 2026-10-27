"use client";

import { useEffect, useRef, useState } from "react";

import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";

/** Сколько слово «Скопировано» держится на кнопке. */
const COPIED_MS = 2000;

/**
 * «Скопировать текст» у черновика, который EVO отправить не может (WhatsApp подключён только на чтение, план Wazzup §7):
 * продавец отправляет его клиенту сам, вне EVO. Копируется ровно то, что на экране; итог - словом на кнопке и вслух
 * (`role="status"`). Без доступа к буферу обмена текст остаётся виден, и это сказано.
 */
export function CopyTextButton({ text, className = QUEUE_CONFIRM }: Readonly<{ text: string; className?: string }>) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    let next: "done" | "failed" = "done";
    try {
      await navigator.clipboard.writeText(text.trim());
    } catch {
      next = "failed";
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), COPIED_MS);
  }

  const word = state === "done" ? "Скопировано" : state === "failed" ? "Не скопировалось — выделите текст вручную" : "Скопировать текст";
  return (
    <>
      <button type="button" className={className} disabled={!text.trim()} onClick={() => void copy()} data-testid="v3-aia-copy-text">
        {word}
      </button>
      <span role="status" aria-live="polite" className="sr-only">{state === "idle" ? "" : word}</span>
    </>
  );
}
