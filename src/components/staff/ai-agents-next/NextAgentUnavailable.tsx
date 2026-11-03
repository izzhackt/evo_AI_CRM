import { PageShell } from "@/components/kit";
import type { AiAgentKey } from "@/lib/ai-agents/contract";
import { aiAgentHref } from "@/lib/v3/ai-agents-view";

import { NextBackLink } from "./NextBackLink";
import { NextNotReady, NextUnavailable } from "./NextNotices";

/** Агент не прочитался («Новый вид»): «Раздел готовится» или отказ с «Повторить», как у прежнего вида. */
export function NextAgentUnavailable({ agentKey, status }: Readonly<{ agentKey: AiAgentKey; status: "not_ready" | "denied" | "unavailable" }>) {
  return (
    <PageShell title="ИИ-агенты" testId="v3-ai-agent-page" back={<NextBackLink />}>
      {status === "not_ready" ? <NextNotReady /> : <NextUnavailable what="агента" retryHref={aiAgentHref(agentKey)} denied={status === "denied"} />}
    </PageShell>
  );
}
