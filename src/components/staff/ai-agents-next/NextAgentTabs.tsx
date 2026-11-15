import Link from "next/link";
import { ClipboardCheckIcon, HistoryIcon, LayoutDashboardIcon, MessageSquareTextIcon, ScrollTextIcon, Settings2Icon, type LucideIcon } from "lucide-react";

import { QueueTabStrip } from "@/components/staff/queue/QueueTabStrip";
import type { AiAgentKey } from "@/lib/ai-agents/contract";
import { AI_AGENT_TABS, aiAgentHref, type AiAgentTab } from "@/lib/v3/ai-agents-view";

const ICONS: Readonly<Record<AiAgentTab, LucideIcon>> = {
  command: MessageSquareTextIcon,
  overview: LayoutDashboardIcon,
  runs: HistoryIcon,
  drafts: ClipboardCheckIcon,
  instructions: ScrollTextIcon,
  settings: Settings2Icon,
};

/** Короче для выбранной вкладки на телефоне: с полным именем шесть разделов не помещаются в 393 px. */
const SHORT: Readonly<Partial<Record<AiAgentTab, string>>> = { runs: "История", drafts: "Одобрение", instructions: "Правила" };

/**
 * Шесть вкладок страницы агента (13.11.2026, «прокачай вкладки»): ссылки `?tab=` в одной рамке-переключателе, у каждой
 * значок раздела. Выбранная — общий `.v3-choice` (нейтральная подложка, вес 600), без красного. Черновики, которые ждут
 * решения, — тёмная плашка с числом: это единственная вкладка, где агент ждёт человека. На узком экране ряд прокручивается
 * вбок, текущая вкладка встаёт в видимую часть (`QueueTabStrip`); на телефоне невыбранные — одним значком, а рамка тянется на всю ширину. `bare` — в строке шапки чата, без отступа снизу.
 */
export function NextAgentTabs({ agentKey, title, tab, draftsPending, bare = false }: Readonly<{
  agentKey: AiAgentKey;
  title: string;
  tab: AiAgentTab;
  draftsPending: number;
  bare?: boolean;
}>) {
  return (
    <QueueTabStrip label={`Разделы агента «${title}»`} testId="v3-aia-tabs">
      <ul className={`inline-flex min-w-max items-center max-sm:flex max-sm:w-full gap-0.5 rounded-card border border-border bg-surface p-1${bare ? "" : " mb-0.5"}`} data-tab-ring="inset">
        {AI_AGENT_TABS.map((one) => {
          const Icon = ICONS[one.key];
          const current = one.key === tab;
          const count = one.key === "drafts" && draftsPending > 0 ? draftsPending : null;
          return (
            <li key={one.key} className="max-sm:flex-1">
              <Link
                href={aiAgentHref(agentKey, { tab: one.key })}
                scroll={false}
                aria-current={current ? "page" : undefined}
                className="v3-choice group/tab inline-flex min-h-11 max-sm:w-full min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-ctl px-3 max-sm:px-2.5 t-label text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg motion-reduce:transition-none"
              >
                <Icon aria-hidden="true" className={`size-4 shrink-0 ${current ? "text-fg" : "text-fg-3 group-hover/tab:text-fg-2"}`} />
                {/* Телефон: у невыбранных — только значок (имя остаётся для читалки), чтобы шесть разделов помещались в ширину. */}
                {current && SHORT[one.key] ? (
                  <>
                    <span className="max-sm:hidden">{one.label}</span>
                    <span className="sm:hidden">{SHORT[one.key]}</span>
                  </>
                ) : <span className={current ? undefined : "max-sm:sr-only"}>{one.label}</span>}
                {count !== null ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-fg px-1.5 t-caption font-semibold tabular-nums text-surface">
                    {count}
                    <span className="sr-only"> ждут решения</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </QueueTabStrip>
  );
}
