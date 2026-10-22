import { Icon } from "@/components/icons";
import { formatDateTimeRu, type ChatItem } from "@/lib/v3/ai-agents-view";

import { Markdown } from "./Markdown";

/**
 * Хроника разговора с агентом (вкладки «Поручить» и «Запуски»): реплики
 * сотрудника и агента, вызовы инструментов — свёрнутыми строками (слово
 * действия, краткий вид аргументов, итог словом; подробности раскрываются),
 * статусные строки и ошибки словами. Цвет только у проблемы; итог всегда со
 * словом, значок его не заменяет.
 */
function ToolRow({ item }: Readonly<{ item: Extract<ChatItem, { kind: "tool" }> }>) {
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
        <Icon name="chevron-down" size={14} className="shrink-0 text-fg-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="space-y-1.5 border-t border-border px-3 py-2 t-meta text-fg-2">
        <p><span className="text-fg-3">Инструмент:</span> {item.builtin ? item.label : `${item.label} (${item.tool})`}</p>
        {item.argsSummary ? <p className="break-words"><span className="text-fg-3">Запрос:</span> {item.argsSummary}</p> : null}
        {item.preview ? <p className="break-words"><span className="text-fg-3">Ответ:</span> {item.preview}</p> : null}
      </div>
    </details>
  );
}

export function ChatTimeline({
  items,
  userLabel = "Вы",
  agentLabel = "Агент",
}: Readonly<{ items: readonly ChatItem[]; userLabel?: string; agentLabel?: string }>) {
  return (
    <ol className="space-y-3" data-testid="v3-aia-timeline">
      {items.map((item) => {
        switch (item.kind) {
          case "user":
            return (
              <li key={item.id} className="flex flex-col items-end gap-1" data-kind="user">
                <span className="t-meta text-fg-3">{userLabel} · {formatDateTimeRu(item.at)}</span>
                <p className="max-w-[88%] whitespace-pre-wrap break-words rounded-card bg-surface-2 px-3 py-2 t-body text-fg">{item.text}</p>
              </li>
            );
          case "agent":
            return (
              <li key={item.id} className="flex flex-col items-start gap-1" data-kind="agent">
                <span className="t-meta text-fg-3">{agentLabel} · {formatDateTimeRu(item.at)}</span>
                <div className="max-w-full rounded-card border border-border bg-surface px-3.5 py-2.5 @2xl:max-w-[92%]"><Markdown source={item.text} /></div>
              </li>
            );
          case "tool":
            return <li key={item.id} data-kind="tool"><ToolRow item={item} /></li>;
          case "status":
            return (
              <li key={item.id} data-kind="status" className="flex items-center gap-3 t-meta text-fg-3">
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
                <span className={item.tone === "ok" ? "text-fg-2" : item.tone === "warn" ? "text-warn" : ""}>{item.text}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
              </li>
            );
          case "error":
            return (
              <li key={item.id} data-kind="error">
                <p role="alert" className="rounded-card bg-danger-weak px-3 py-2 t-body-compact text-danger">{item.text}</p>
              </li>
            );
        }
      })}
    </ol>
  );
}
