import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  AiAgentNav,
  AiAgentNotice,
  AiDocumentsView,
  AiRulesView,
  AiSpendView,
} from "@/components/v3/ai-agent/AiAgentViews";
import { PartShell } from "@/components/v3/PartShell";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { aiAgentFeatureOn } from "@/lib/server/ai-agent-internal-auth";
import { readAiAgentStatus } from "@/lib/server/ai-agent-route-handlers";
import { aiAgentHref, parseAiAgentSection } from "@/lib/v3/ai-agent";
import { readAiDocuments, readAiRules, readAiSettings, readAiSpend } from "@/lib/v3/ai-agent-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "ИИ-агент" };

type Query = Record<string, string | string[] | undefined>;

/**
 * «ИИ-агент» (план ИИ-агента §12.2): все сотрудники (Q9, право ai.agent.use).
 * `?section=` — «Информация для агента» (по умолчанию), «Правила общения»,
 * «Расходы»; вкладки — настоящие ссылки. Чтения и записи — прямо в RPC базы
 * от имени сотрудника; агент нужен только для состояния Gemini в «Расходах».
 * Просмотр роли администратором видит то же, что роль, и ничего не пишет.
 */
export default async function AiAgentPage({ searchParams }: Readonly<{ searchParams: Promise<Query> }>) {
  const actor = await requireV3PageActor("/v3/ai-agent");
  const query = await searchParams;
  if (Object.keys(query).some((key) => key !== "section") || Array.isArray(query.section)) notFound();
  const section = parseAiAgentSection(query.section as string | undefined);
  if (!section) notFound();
  const preview = isStaffPreview(actor);
  const retryHref = aiAgentHref(section);
  const settings = await readAiSettings(actor);
  const settingsData = settings.status === "available" ? settings.data : null;

  let content: ReactNode;
  if (section === "documents") {
    const read = await readAiDocuments(actor);
    const requestIds = read.status === "available"
      ? Object.fromEntries(read.data.items.filter((item) => item.status === "failed").map((item) => [item.id, randomUUID()]))
      : {};
    content = <AiDocumentsView read={read} preview={preview} requestIds={requestIds} retryHref={retryHref} />;
  } else if (section === "rules") {
    content = (
      <AiRulesView
        read={await readAiRules(actor)}
        preview={preview}
        editorRequestId={randomUUID()}
        confirmRequestId={randomUUID()}
        retryHref={retryHref}
      />
    );
  } else {
    const [spend, agentStatus] = await Promise.all([readAiSpend(actor), readAiAgentStatus(actor.organizationId)]);
    content = (
      <AiSpendView
        spend={spend}
        settings={settings}
        agentStatus={agentStatus}
        preview={preview}
        capRequestId={randomUUID()}
        revokeRequestId={randomUUID()}
        retryHref={retryHref}
      />
    );
  }

  return (
    <PartShell title="ИИ-агент" testId="v3-ai-agent">
      <div className="space-y-5">
        <AiAgentNav section={section} />
        <AiAgentNotice settings={settingsData} featureOn={aiAgentFeatureOn()} preview={preview} consentRequestId={randomUUID()} />
        {content}
      </div>
    </PartShell>
  );
}
