import Image from "next/image";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { HelpTip } from "@/components/kit";
import { StatusChip } from "@/components/staff/blocks/StatusChip";
import type { AiAgentListItem } from "@/lib/ai-agents/contract";
import { aiAgentHref, aiAgentLastRun, aiAgentRoleLine, aiAgentStateChip, pluralRu } from "@/lib/v3/ai-agents-view";

import { AGENT_MASCOTS } from "./agent-mascots";

const ACTION = "relative z-10 inline-flex min-h-11 items-center gap-1 t-meta font-medium text-fg underline underline-offset-4";
/**
 * «N черновиков ждут решения» — цель 44 px, как «Поручить». Она занимает зазор над собой (`gap-2`) и поле карточки под собой
 * (`p-3`) через отрицательные поля: сама карточка при этом выше всего на 8 px, а не на 28, и цель не заходит на соседей.
 */
const DRAFTS = "relative z-10 -mb-3 -mt-2 inline-flex min-h-11 w-fit items-center t-meta text-fg underline underline-offset-4";
/** Слово итога последнего запуска: красное — только ошибка, жёлтое — «нужно внимание» и лимит; остальные — обычным цветом. */
const RESULT_TONE = { danger: "font-medium text-danger", warn: "font-medium text-warn", neutral: "", ok: "", info: "" } as const;

/**
 * Карточка агента в списке «Агенты» (12.11.2026, по просьбе Айвара — маскоты): сверху маскот на сером столе (при наведении
 * чуть приподнимается), ниже имя (вся карточка ведёт к агенту), «?» с ролью, чипы словом — состояние и «Авто: вкл» (только у
 * включённого агента с включённым «Авто»: он сам пишет клиентам, и это должно быть видно на главной; выключенный не пишет
 * никому, чипа у него нет), когда работал и чем кончилось («3 ч назад · Готово»), черновики, внизу одно действие — «Поручить»
 * (сразу в чат), «Правила» или «Открыть»: нижняя строка есть у всех карточек, поэтому ряды списка одной высоты (13.11.2026).
 */
export function NextAgentCard({ agent, now, rules, action }: Readonly<{
  agent: AiAgentListItem;
  now: string;
  rules: boolean;
  action: "ask" | "rules" | "open";
}>) {
  const state = aiAgentStateChip({ enabled: agent.enabled, hasInstructions: rules, syncStatus: agent.sync.status, needsSync: false });
  const mascot = AGENT_MASCOTS[agent.key];
  const last = rules ? aiAgentLastRun(agent.stats, now) : null;
  return (
    <li
      data-testid={`v3-aia-card-${agent.key}`}
      className="group/agent relative flex flex-col overflow-hidden rounded-card border border-border bg-surface transition-colors hover:border-border-strong has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-focus-ring motion-reduce:transition-none"
    >
      <span aria-hidden="true" className="grid h-32 place-items-center border-b border-border bg-surface-2">
        {mascot ? (
          <Image src={mascot} alt="" width={112} height={112} className="size-28 object-contain transition-transform duration-200 ease-out group-hover/agent:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover/agent:translate-y-0" />
        ) : null}
      </span>
      <span className="grid flex-1 content-start gap-2 p-3">
        <span className="flex min-w-0 items-start gap-1">
          <Link href={aiAgentHref(agent.key)} className="min-w-0 t-item text-fg outline-none after:absolute after:inset-0 after:rounded-card">{agent.title}</Link>
          <HelpTip label={`Пояснение: ${agent.title}`} className="relative z-10">{aiAgentRoleLine(agent.roleLine)}</HelpTip>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip label={state.label} tone={state.tone} size="sm" />
          {agent.autoSend && agent.enabled ? <StatusChip label="Авто: вкл" tone="warn" size="sm" title="Агент сам пишет клиентам и студентам без одобрения" /> : null}
        </span>
        {last ? (
          <span className="t-meta text-fg-3" data-testid={`v3-aia-last-${agent.key}`}>
            <span className="sr-only">Последний запуск: </span>
            {last.when}
            {last.result ? <> · <span className={RESULT_TONE[last.tone]}>{last.result}</span></> : null}
          </span>
        ) : null}
        {agent.stats.draftsPending > 0 ? (
          <Link href={aiAgentHref(agent.key, { tab: "drafts" })} className={DRAFTS} data-testid={`v3-aia-drafts-${agent.key}`}>
            {agent.stats.draftsPending} {pluralRu(agent.stats.draftsPending, ["черновик ждёт", "черновика ждут", "черновиков ждут"])} решения
          </Link>
        ) : null}
      </span>
      <span className="border-t border-border px-3">
        {action === "ask" ? (
          <Link href={aiAgentHref(agent.key, { tab: "command" })} data-testid={`v3-aia-ask-${agent.key}`} className={ACTION}>Поручить<ArrowRightIcon aria-hidden="true" className="size-4" /></Link>
        ) : action === "rules" ? (
          <Link href={aiAgentHref(agent.key, { tab: "instructions" })} data-testid={`v3-aia-rules-${agent.key}`} className={ACTION}>Правила<ArrowRightIcon aria-hidden="true" className="size-4" /></Link>
        ) : (
          // Имя уже ведёт на страницу агента: для читалки вторая ссылка туда же лишняя.
          <span aria-hidden="true" className="inline-flex min-h-11 items-center gap-1 t-meta font-medium text-fg-2">Открыть<ArrowRightIcon className="size-4" /></span>
        )}
      </span>
    </li>
  );
}
