import "../../ai-agents.css";

import { AgentsHub } from "@/components/v3/ai-agents/AgentsHub";
import { NextAgentsViewLazy } from "@/components/v3/ai-agents-next/NextAgentsLazy";
import { NotReady, PreviewLine, Unavailable } from "@/components/v3/ai-agents/Notices";
import { PartShell } from "@/components/v3/PartShell";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isNextUi } from "@/lib/ui-next";
import { nextAgentsHasDefault } from "@/lib/server/ai-agents/next-defaults";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { aiAgentsRuntimeAvailability, reconcileAiAgentRuns } from "@/lib/server/ai-agents/runtime";
import { AI_AGENTS_HUB_HREF } from "@/lib/v3/ai-agents-view";
import { readAiAgents } from "@/lib/v3/ai-agents-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "ИИ-агенты" };

/**
 * «ИИ-агенты» (решение владельца 22.10.2026, docs/design/ai-agents/contract.md
 * §D.3): хаб с карточками агентов по группам Продажи / Аналитика / Кураторы и
 * отдельной карточкой Gemini-помощника. Все сотрудники (право ai.agent.use);
 * чтение — RPC сотрудника, сверка запусков — через рантайм (не бросает).
 * Просмотр роли видит то же, что роль, и ничего не меняет.
 * «Новый вид» (27.10.2026): тот же набор чтений, другой вид — только настоящему администратору с включённым переключателем.
 * Каталог текстов агентов остаётся на сервере: новому виду уходит только «есть ли инструкция» (`nextAgentsHasDefault`).
 */
export default async function AiAgentsPage() {
  const actor = await requireV3PageActor("/v3/ai-agents");
  const preview = isStaffPreview(actor);
  const runtime = aiAgentsRuntimeAvailability();
  if (runtime.configured && !preview) {
    // Дёшево (внутри ограничитель на агента) и не мешает показу: сбой сверки молчит.
    try { await reconcileAiAgentRuns({ staffClient: await createSupabaseServerClient(), actor }, {}); } catch { /* сверка ленивая */ }
  }
  const list = await readAiAgents(actor);
  if (await isNextUi(actor)) return <NextAgentsViewLazy read={list} runtimeConfigured={runtime.configured} preview={preview} hasDefault={nextAgentsHasDefault()} />;

  return (
    <PartShell title="ИИ-агенты" testId="v3-ai-agents">
      <div className="space-y-5">
        {preview ? <PreviewLine /> : null}
        {list.status === "available" ? (
          <AgentsHub list={list.data} runtimeConfigured={runtime.configured} preview={preview} />
        ) : list.status === "not_ready" ? (
          <NotReady />
        ) : (
          <Unavailable what="агентов" retryHref={AI_AGENTS_HUB_HREF} denied={list.status === "denied"} />
        )}
      </div>
    </PartShell>
  );
}
