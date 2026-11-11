"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { WidgetCard } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { AiAgentKey } from "@/lib/ai-agents/contract";
import { AI_AGENT_ASK_STORAGE, AI_AGENT_STARTERS, aiAgentHref } from "@/lib/v3/ai-agents-view";

export type NextAskAgent = Readonly<{ key: AiAgentKey; title: string }>;

/**
 * «Спросить агента» — панель справа на главной (11.11.2026, по образцу Molar AI «Ask Molar»): выбрать агента, взять пример
 * поручения или написать своё и перейти в чат агента с готовым текстом. Отправляет сам сотрудник уже в чате: панель только
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
    <WidgetCard title="Спросить агента" size="sm">
      {agents.length === 0 || !key ? (
        <p className="t-meta text-fg-2" data-testid="v3-aia-askbox-blocked">{blockedNote ?? "Сейчас нет агентов, которым можно поручить."}</p>
      ) : (
        <form className="grid gap-3" data-testid="v3-aia-askbox" onSubmit={(event) => { event.preventDefault(); ask(); }}>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-agent`}>Агент</Label>
            <NativeSelect id={`${id}-agent`} value={key} onChange={(event) => setKey(event.target.value as AiAgentKey)}>
              {agents.map((agent) => <option key={agent.key} value={agent.key}>{agent.title}</option>)}
            </NativeSelect>
          </div>
          <ul className="flex flex-col gap-1.5" aria-label="Примеры поручений">
            {AI_AGENT_STARTERS[key].map((starter) => (
              <li key={starter}>
                <Button type="button" variant="outline" onClick={() => setText(starter)} className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-start t-meta">
                  {starter}
                </Button>
              </li>
            ))}
          </ul>
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-text`} className="sr-only">Поручение</Label>
            <Textarea id={`${id}-text`} value={text} onChange={(event) => setText(event.target.value)} rows={3} maxLength={4000} placeholder="Напишите поручение…" />
          </div>
          {blockedNote ? <p className="t-meta text-fg-2" data-testid="v3-aia-askbox-blocked">{blockedNote}</p> : null}
          <Button type="submit" disabled={Boolean(blockedNote) || !text.trim()}>Перейти в чат агента</Button>
        </form>
      )}
    </WidgetCard>
  );
}
