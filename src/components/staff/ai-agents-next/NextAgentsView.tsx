import { PageShell } from "@/components/kit";
import type { AiAgentsListResult } from "@/lib/ai-agents/contract";
import type { AiAgentsPending } from "@/lib/v3/ai-agents-source";
import { AI_AGENTS_HUB_HREF } from "@/lib/v3/ai-agents-view";

import type { NextAgentsHasDefault } from "./agent-defaults";
import { NextAgentsHub } from "./NextAgentsHub";
import { NextNotReady, NextPreviewLine, NextUnavailable } from "./NextNotices";

/** Страница «ИИ-агенты» в «Новом виде»: рамка набора и то, что прочиталось (хаб, «раздел готовится» или отказ). */
export function NextAgentsView({
  read,
  pending = null,
  runtimeConfigured,
  preview,
  hasDefault,
}: Readonly<{
  /** Черновики «Ждут решения» главной; null — не читались (раздел недоступен). */
  pending?: AiAgentsPending | null;
  read: Readonly<{ status: "available"; data: AiAgentsListResult }> | Readonly<{ status: "not_ready" | "denied" | "missing" | "unavailable" }>;
  runtimeConfigured: boolean;
  preview: boolean;
  hasDefault: NextAgentsHasDefault;
}>) {
  return (
    <PageShell title="ИИ-агенты" testId="v3-ai-agents">
      {preview ? <NextPreviewLine /> : null}
      {read.status === "available" ? (
        <NextAgentsHub list={read.data} pending={pending} runtimeConfigured={runtimeConfigured} preview={preview} hasDefault={hasDefault} />
      ) : read.status === "not_ready" ? (
        <NextNotReady />
      ) : (
        <NextUnavailable what="агентов" retryHref={AI_AGENTS_HUB_HREF} denied={read.status === "denied"} />
      )}
    </PageShell>
  );
}
