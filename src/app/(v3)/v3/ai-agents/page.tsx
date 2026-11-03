import "../../ai-agents.css";

import { NextAgentsViewLazy } from "@/components/v3/ai-agents-next/NextAgentsLazy";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { nextAgentsHasDefault } from "@/lib/server/ai-agents/next-defaults";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { aiAgentsRuntimeAvailability, reconcileAiAgentRuns } from "@/lib/server/ai-agents/runtime";
import { readAiAgents } from "@/lib/v3/ai-agents-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "ИИ-агенты" };

/**
 * «ИИ-агенты» (решение владельца 22.10.2026, docs/design/ai-agents/contract.md
 * §D.3): хаб с карточками агентов по группам Продажи / Аналитика / Кураторы и
 * отдельной карточкой Gemini-помощника. Все сотрудники (право ai.agent.use);
 * чтение — RPC сотрудника, сверка запусков — через рантайм (не бросает).
 * Просмотр роли видит то же, что роль, и ничего не меняет.
 * «Новый вид» — единственный вид (#1327).
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
  return <NextAgentsViewLazy read={list} runtimeConfigured={runtime.configured} preview={preview} hasDefault={nextAgentsHasDefault()} />;
}
