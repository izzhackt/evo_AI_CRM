"use client";

import { useRouter } from "next/navigation";
import { SendHorizontalIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { AiAgentKey } from "@/lib/ai-agents/contract";
import { AI_AGENT_ASK_STORAGE, aiAgentHref } from "@/lib/v3/ai-agents-view";

export type NextAskAgent = Readonly<{ key: AiAgentKey; title: string }>;

/**
 * «Спросить агента» — панель справа на главной (11.11.2026, по образцу Molar AI «Ask Molar»): выбрать агента, написать
 * поручение (примеры — уже в чате агента) и перейти в чат агента с готовым текстом. Отправляет сам сотрудник уже в чате: панель только
 * переносит текст (память вкладки, не адрес). Нельзя поручать (нет ключа Claude, просмотр роли) — кнопка выключена и
 * причина словами; агентов с правилами нет — только причина.
 */
export function NextAgentsAsk({ agents, blockedNote }: Readonly<{ agents: readonly NextAskAgent[]; blockedNote: string | null }>) {
  const router = useRouter();
  const id = useId();
  const [key, setKey] = useState<AiAgentKey | null>(agents[0]?.key ?? null);
  const [text, setText] = useState("");
  const ask = () => {
    if (!key) return;
    try { window.sessionStorage.setItem(`${AI_AGENT_ASK_STORAGE}${key}`, text.trim()); } catch { /* без памяти вкладки — просто откроем чат */ }
    router.push(aiAgentHref(key));
  };
  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-3 rounded-card border border-border bg-surface p-4" data-testid="v3-aia-askcard">
      <h2 id={`${id}-title`} className="t-item text-fg">Спросить агента</h2>
      {agents.length === 0 || !key ? (
        <p className="t-meta text-fg-2" data-testid="v3-aia-askbox-blocked">{blockedNote ?? "Сейчас нет агентов, которым можно поручить."}</p>
      ) : (
        <form className="grid gap-3" data-testid="v3-aia-askbox" onSubmit={(event) => { event.preventDefault(); ask(); }}>
          <div className="grid">
            <Label htmlFor={`${id}-agent`} className="sr-only">Кому</Label>
            <NativeSelect id={`${id}-agent`} value={key} onChange={(event) => setKey(event.target.value as AiAgentKey)}>
              {agents.map((agent) => <option key={agent.key} value={agent.key}>{agent.title}</option>)}
            </NativeSelect>
          </div>
          <div className="relative">
            <Label htmlFor={`${id}-text`} className="sr-only">Поручение</Label>
            <Textarea id={`${id}-text`} value={text} onChange={(event) => setText(event.target.value)} rows={3} maxLength={4000} placeholder="Напишите поручение…" className="min-h-28 resize-none rounded-card pe-14" />
            <Button
              type="submit"
              size="icon"
              aria-label="Перейти в чат агента"
              disabled={Boolean(blockedNote) || !text.trim()}
              className="absolute end-2 bottom-2 rounded-full"
            >
              <SendHorizontalIcon aria-hidden="true" className="size-4" />
            </Button>
          </div>
          {blockedNote ? <p className="t-meta text-fg-2" data-testid="v3-aia-askbox-blocked">{blockedNote}</p> : null}
        </form>
      )}
    </section>
  );
}
