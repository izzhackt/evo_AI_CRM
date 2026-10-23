"use client";

import { useMemo, useState, type ReactNode } from "react";

import { Icon } from "@/components/icons";
import { cn } from "@/components/ui";
import { formatDateTimeRu, groupChatItems, stepsSummary, type ChatItem, type ToolChatItem } from "@/lib/v3/ai-agents-view";

import { AnswerActions } from "./AnswerActions";
import { Markdown } from "./Markdown";

/**
 * Хроника разговора с агентом (вкладки «Поручить» и «Запуски»): реплики
 * сотрудника — пузырём справа, ответы агента — белым листом на всю колонку с
 * действиями под ним, вызовы инструментов — одной свёрнутой строкой «Ход
 * работы» на каждую серию (внутри — свёрнутые строки вызовов: слово действия,
 * краткий вид аргументов, итог словом), статусные строки и ошибки словами. Цвет
 * только у проблемы; итог всегда со словом, значок его не заменяет.
 */
function ToolRow({ item }: Readonly<{ item: ToolChatItem }>) {
  const stateWord = item.state === "running" ? "выполняется" : item.state === "ok" ? "готово" : "ошибка";
  const icon = item.state === "running" ? "clock" : item.state === "ok" ? "check" : "alert";
  return (
    <details className="group rounded-nav border border-border bg-surface" data-testid="v3-aia-tool-row" data-state={item.state}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-1.5 t-body-compact text-fg-2 [&::-webkit-details-marker]:hidden">
        <Icon name={icon} size={14} className={`shrink-0 ${item.state === "error" ? "text-danger" : "text-fg-3"}`} />
        <span className="min-w-0 flex-1 truncate">
          <span className="text-fg">{item.word}</span>
          {item.argsSummary ? <span className="text-fg-3"> · {item.argsSummary}</span> : null}
        </span>
        <span className={`shrink-0 t-meta ${item.state === "error" ? "text-danger" : "text-fg-3"}`}>{stateWord}</span>
        <Icon name="chevron-down" size={14} className="shrink-0 text-fg-3 transition-transform duration-[180ms] group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="space-y-1.5 border-t border-border px-3 py-2 t-meta text-fg-2">
        <p><span className="text-fg-3">Инструмент:</span> {item.builtin ? item.label : `${item.label} (${item.tool})`}</p>
        {item.argsSummary ? <p className="break-words"><span className="text-fg-3">Запрос:</span> {item.argsSummary}</p> : null}
        {item.preview ? <p className="break-words"><span className="text-fg-3">Ответ:</span> {item.preview}</p> : null}
      </div>
    </details>
  );
}

/** «Ход работы · 5 шагов»: серия вызовов одной строкой; раскрытая — тот же список строк вызовов. Идущая серия говорит, что делает сейчас. */
function StepsGroup({ steps, working }: Readonly<{ steps: readonly ToolChatItem[]; working: boolean }>) {
  const summary = stepsSummary(steps, working);
  const icon = summary.running ? "clock" : summary.errors ? "alert" : "check";
  return (
    <details className="group/steps" data-testid="v3-aia-steps" data-state={summary.running ? "running" : "done"}>
      <summary className="-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-nav px-2 t-body-compact text-fg-2 hover:bg-surface-2 hover:text-fg [&::-webkit-details-marker]:hidden">
        <Icon name={icon} size={14} className={cn("shrink-0", summary.errors && !summary.running ? "text-danger" : "text-fg-3")} />
        <span className="min-w-0 flex-1 truncate">
          {summary.title}
          {summary.errors ? <> · <span className="text-danger">{summary.errors}</span></> : null}
        </span>
        <Icon name="chevron-down" size={14} className="shrink-0 text-fg-3 transition-transform duration-[180ms] group-open/steps:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {steps.map((step) => <li key={step.id}><ToolRow item={step} /></li>)}
      </ul>
    </details>
  );
}

/**
 * Строка хроники. Появление (`v3-aia-in`: проявление и подъём на 4 px, только
 * при разрешённом движении) решается один раз — когда строка создана: уже
 * показанная история не оживает заново, когда `animate` позже включают.
 */
function Entry({ kind, animate, className, children }: Readonly<{ kind: string; animate: boolean; className?: string; children: ReactNode }>) {
  const [fresh] = useState(animate);
  return <li data-kind={kind} className={cn(className, fresh && "v3-aia-in")}>{children}</li>;
}

export function ChatTimeline({
  items,
  userLabel,
  agentLabel = "Агент",
  runMeta = null,
  allowTask = false,
  working = false,
  staticIds = null,
}: Readonly<{
  items: readonly ChatItem[];
  /** Подпись перед временем под репликой сотрудника («Поручение» в «Запусках»); без неё — только время. */
  userLabel?: string;
  agentLabel?: string;
  /** «12 с · 0,11 $ · 5 шагов» под последним ответом закончившегося запуска. */
  runMeta?: string | null;
  /** «Сделать задачей» под ответами (в «Запусках» не нужна). */
  allowTask?: boolean;
  /** Агент работает сейчас: идущая серия вызовов говорит, что делает. У закончившегося запуска — просто число шагов. */
  working?: boolean;
  /**
   * Какие реплики показаны без движения (уже существовавшая история); остальные появляются
   * подъёмом. `null` — движения нет совсем (хроника «Запусков», история ещё грузится).
   */
  staticIds?: ReadonlySet<string> | null;
}>) {
  const blocks = useMemo(() => groupChatItems(items), [items]);
  const lastAgent = blocks.findLastIndex((block) => block.kind === "agent");
  return (
    <ol className="flex flex-col gap-4" data-testid="v3-aia-timeline">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "user":
            return (
              <Entry key={block.id} kind="user" animate={staticIds !== null && !staticIds.has(block.id)} className="flex flex-col items-end gap-1">
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-card bg-accent-weak px-3.5 py-2.5 t-body text-fg">{block.text}</p>
                <span className="t-meta text-fg-3">{userLabel ? `${userLabel} · ` : ""}{formatDateTimeRu(block.at)}</span>
              </Entry>
            );
          case "agent":
            return (
              <Entry key={block.id} kind="agent" animate={staticIds !== null && !staticIds.has(block.id)} className="flex flex-col gap-1.5">
                <span className="t-meta text-fg-3">{agentLabel} · {formatDateTimeRu(block.at)}</span>
                <div className="rounded-card border border-border bg-surface px-4 py-3.5 @2xl:px-5 @2xl:py-4 [&_.t-body]:leading-[1.6]">
                  <Markdown source={block.text} />
                </div>
                <AnswerActions text={block.text} allowTask={allowTask} meta={index === lastAgent ? runMeta : null} />
              </Entry>
            );
          case "steps":
            return <li key={block.id} data-kind="steps"><StepsGroup steps={block.steps} working={working} /></li>;
          case "status":
            return (
              <li key={block.id} data-kind="status" className="flex items-center gap-3 t-meta text-fg-3">
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
                <span className={block.tone === "ok" ? "text-fg-2" : block.tone === "warn" ? "text-warn" : ""}>{block.text}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
              </li>
            );
          case "error":
            return (
              <li key={block.id} data-kind="error">
                <p role="alert" className="rounded-card bg-danger-weak px-3 py-2 t-body-compact text-danger">{block.text}</p>
              </li>
            );
        }
      })}
    </ol>
  );
}
