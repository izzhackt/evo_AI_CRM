"use client";

import { useState } from "react";

import { QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";

/**
 * Значение для кабинета ВАТС (адрес приёма) и кнопка «Скопировать». Копируется
 * только то, что и так показано на экране; ключей здесь нет. Без доступа к
 * буферу обмена (старый браузер, запрет) значение остаётся видимым и
 * выделяется вручную.
 */
export function TelephonyCopyValue({ value, label }: Readonly<{ value: string; label: string }>) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <code className="min-w-0 break-all rounded-ctl bg-surface-2 px-2 py-1 font-mono text-[0.8125rem] leading-5 text-fg" data-testid="v3-telephony-copy-value">{value}</code>
      <button type="button" className={QUEUE_SECONDARY} onClick={copy} aria-label={`Скопировать: ${label}`}>
        {state === "copied" ? "Скопировано" : "Скопировать"}
      </button>
      {state === "failed" ? <span role="status" className="t-meta text-fg-2">Не удалось скопировать — выделите значение вручную.</span> : null}
    </span>
  );
}
