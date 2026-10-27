import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { PageHeader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import type { AiAgentKey } from "@/lib/ai-agents/contract";
import { AI_AGENTS_HUB_HREF, aiAgentHref } from "@/lib/v3/ai-agents-view";

import { NextNotReady, NextUnavailable } from "./NextNotices";

/** Агент не прочитался («Новый вид»): «Раздел готовится» или отказ с «Повторить», как у прежнего вида. */
export function NextAgentUnavailable({ agentKey, status }: Readonly<{ agentKey: AiAgentKey; status: "not_ready" | "denied" | "unavailable" }>) {
  return (
    <main data-testid="v3-ai-agent-page" className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      <Button variant="ghost" asChild className="-ms-3 mb-2"><Link href={AI_AGENTS_HUB_HREF}><ArrowLeftIcon aria-hidden="true" /> Все ИИ-агенты</Link></Button>
      <PageHeader title="ИИ-агенты" />
      <div className="mt-6">
        {status === "not_ready" ? <NextNotReady /> : <NextUnavailable what="агента" retryHref={aiAgentHref(agentKey)} denied={status === "denied"} />}
      </div>
    </main>
  );
}
