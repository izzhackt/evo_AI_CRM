import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  AiAgentNav,
  AiAgentNotice,
  AiDocumentsView,
  AiRulesView,
  AiSpendView,
  AiUnavailable,
} from "@/components/v3/ai-agent/AiAgentViews";
import { AiDocumentViewer } from "@/components/v3/ai-agent/AiDocumentViewer";
import { AiExamplesList } from "@/components/v3/ai-agent/AiExamplesList";
import { AiLaboratory } from "@/components/v3/ai-agent/AiLaboratory";
import { AiReviewSheet } from "@/components/v3/ai-agent/AiReviewSheet";
import { PartShell } from "@/components/v3/PartShell";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { aiAgentFeatureOn } from "@/lib/server/ai-agent-internal-auth";
import { readAiAgentStatus } from "@/lib/server/ai-agent-route-handlers";
import { aiAgentHref, parseAiAgentRoute } from "@/lib/v3/ai-agent";
import {
  readAiDocumentDetail,
  readAiDocumentPage,
  readAiDocuments,
  readAiExamples,
  readAiLab,
  readAiReview,
  readAiRules,
  readAiSettings,
  readAiSpend,
} from "@/lib/v3/ai-agent-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "ИИ-агент" };

type Query = Record<string, string | string[] | undefined>;

const requestIdsFor = (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, randomUUID()]));

/**
 * «ИИ-агент» (план ИИ-агента §12.2): все сотрудники (Q9, право ai.agent.use).
 * Подразделы — настоящие ссылки `?section=`: «Информация для агента» (список,
 * загрузка, «Новая версия» `?replace=`, просмотр `?document=&page=&chunk=`),
 * «Лист сверки» (`?status=resolved`, `?document=`), «Лаборатория», «Правила
 * общения», «Расходы». Чтения и записи — прямо в RPC базы от имени
 * сотрудника; агент нужен для Лаборатории (через маршруты CRM) и состояния
 * Gemini в «Расходах». Просмотр роли видит то же, что роль, и ничего не пишет.
 */
export default async function AiAgentPage({ searchParams }: Readonly<{ searchParams: Promise<Query> }>) {
  const actor = await requireV3PageActor("/v3/ai-agent");
  const route = parseAiAgentRoute(await searchParams);
  if (!route) notFound();
  const { section } = route;
  const preview = isStaffPreview(actor);
  const featureOn = aiAgentFeatureOn();
  const retryHref = aiAgentHref(section, section === "documents"
    ? { document: route.documentId, page: route.page, replace: route.replaceId }
    : section === "review" ? { status: route.reviewFilter === "open" ? null : route.reviewFilter, document: route.documentId } : {});
  // Сколько пунктов «Листа сверки» ждут решения (открытые и применяемые) —
  // у вкладки на каждом подразделе.
  const [settings, reviewCount] = await Promise.all([
    readAiSettings(actor),
    section === "review" ? Promise.resolve(null) : readAiReview(actor, { filter: "open", documentId: null, limit: 1 }),
  ]);
  const settingsData = settings.status === "available" ? settings.data : null;
  let reviewOpenCount = reviewCount?.status === "available" ? reviewCount.data.pendingCount : null;

  let content: ReactNode;
  if (section === "documents" && route.documentId) {
    const detail = await readAiDocumentDetail(actor, route.documentId);
    if (detail.status === "missing") notFound();
    if (detail.status !== "available") {
      content = <AiUnavailable what="документ" retryHref={retryHref} />;
    } else {
      const pages = detail.data.pages;
      // Без страниц (TXT, CSV, MD, знания из базы) весь текст документа —
      // «страница 1» у `ai_agent_document_page_v1` (271), фрагменты — без страниц.
      const textOnly = pages.length === 0;
      const busy = detail.data.document.status === "queued" || detail.data.document.status === "processing";
      if (route.page !== null && (textOnly ? route.page !== 1 : !pages.some((page) => page.pageNo === route.page))) notFound();
      const pageNo = route.page ?? pages[0]?.pageNo ?? (textOnly && !busy ? 1 : null);
      const page = pageNo !== null ? await readAiDocumentPage(actor, route.documentId, pageNo) : null;
      content = (
        <AiDocumentViewer
          detail={detail.data}
          page={page?.status === "available" ? page.data : null}
          pageNo={pageNo}
          pageRead={page === null ? "none" : page.status === "available" ? "available" : page.status === "missing" ? "missing" : "unavailable"}
          highlightChunkId={route.chunkId}
        />
      );
    }
  } else if (section === "documents") {
    const read = await readAiDocuments(actor);
    const items = read.status === "available" ? read.data.items : [];
    content = (
      <AiDocumentsView
        read={read}
        preview={preview}
        retryHref={retryHref}
        replaceId={route.replaceId}
        featureOn={featureOn}
        requestIds={{
          upload: randomUUID(),
          retry: requestIdsFor(items.filter((item) => item.status === "failed").map((item) => item.id)),
          company: requestIdsFor(items.filter((item) => item.status === "failed").map((item) => item.id)),
          remove: requestIdsFor(items.map((item) => item.id)),
        }}
      />
    );
  } else if (section === "review") {
    const read = await readAiReview(actor, { filter: route.reviewFilter, documentId: route.documentId, limit: 50 });
    if (read.status === "available" && route.reviewFilter === "open" && !route.documentId) reviewOpenCount = read.data.pendingCount;
    content = (
      <AiReviewSheet
        read={read}
        filter={route.reviewFilter}
        documentId={route.documentId}
        preview={preview}
        requestIds={requestIdsFor(read.status === "available" ? read.data.items.map((item) => item.id) : [])}
        retryHref={retryHref}
      />
    );
  } else if (section === "lab") {
    const [lab, examples] = await Promise.all([readAiLab(actor), readAiExamples(actor)]);
    content = (
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <AiLaboratory
          initial={lab.status === "available" ? lab.data : null}
          featureOn={featureOn}
          preview={preview}
          requestIds={{ discard: randomUUID(), reject: randomUUID() }}
        />
        <AiExamplesList
          read={examples}
          preview={preview}
          requestIds={requestIdsFor(examples.status === "available" ? examples.data.items.map((item) => item.id) : [])}
        />
      </div>
    );
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
        <AiAgentNav section={section} reviewOpenCount={reviewOpenCount} />
        <AiAgentNotice settings={settingsData} featureOn={featureOn} preview={preview} consentRequestId={randomUUID()} />
        {content}
      </div>
    </PartShell>
  );
}
