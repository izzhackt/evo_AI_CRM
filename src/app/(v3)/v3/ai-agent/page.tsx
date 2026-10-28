import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";
import {
  AiAgentNav,
  AiAgentNotice,
  AiDocumentsView,
  AiRulesView,
  AiSpendView,
  AiUnavailable,
} from "@/components/v3/ai-agent/AiAgentViews";
import { AiAutosendPauseBanner, AiAutosendView } from "@/components/v3/ai-agent/AiAutosendView";
import { AiDocumentViewer } from "@/components/v3/ai-agent/AiDocumentViewer";
import { AiExamplesList } from "@/components/v3/ai-agent/AiExamplesList";
import { AiLaboratory } from "@/components/v3/ai-agent/AiLaboratory";
import { AiReviewSheet } from "@/components/v3/ai-agent/AiReviewSheet";
import type { AiAgentNextBody } from "@/components/v3/ai-agent-next/ai-agent-next-types";
import { AiAgentNextLazy } from "@/components/v3/ai-agent-next/AiAgentNextLazy";
import { PartShell } from "@/components/v3/PartShell";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
import { isNextUi } from "@/lib/ui-next";
import { aiAgentFeatureOn } from "@/lib/server/ai-agent-internal-auth";
import { aiAutosendServerState } from "@/lib/server/ai-agent-send-config";
import { readAiAgentStatus } from "@/lib/server/ai-agent-route-handlers";
import { AI_AGENT_SECTIONS, aiAgentHref, parseAiAgentRoute } from "@/lib/v3/ai-agent";
import { AI_AGENTS_HUB_HREF } from "@/lib/v3/ai-agents-view";
import { readAiAutosend, readAiAutosendJournal, readAiAutosendSummary } from "@/lib/v3/ai-agent-autosend-source";
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
 * Подразделы — настоящие ссылки `?section=`: «Материалы» (список,
 * загрузка, «Новая версия» `?replace=`, просмотр `?document=&page=&chunk=`),
 * «Лист сверки» (`?status=resolved`, `?document=`), «Лаборатория», «Правила
 * общения», «Расходы», «Автоответчик» (P4: `?view=journal|summary`, пауза —
 * строкой над каждым подразделом). Чтения и записи — прямо в RPC базы от имени
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
  // «Новый вид» (переключатель администратора): те же чтения, права и request_id, другая расстановка; содержимое подраздела — данными для входа.
  const next = await isNextUi(actor);
  let nextBody: AiAgentNextBody | null = null;
  const retryHref = aiAgentHref(section, section === "documents"
    ? { document: route.documentId, page: route.page, replace: route.replaceId }
    : section === "review" ? { status: route.reviewFilter === "open" ? null : route.reviewFilter, document: route.documentId }
      : section === "autosend" && route.autosend ? {
        view: route.autosend.view === "settings" ? null : route.autosend.view,
        status: route.autosend.journalFilter === "all" ? null : route.autosend.journalFilter,
        summary: route.autosend.summaryId,
      } : {});
  // Сколько пунктов «Листа сверки» ждут решения (открытые и применяемые) —
  // у вкладки на каждом подразделе.
  // Автоответчик (P4) читается на каждом подразделе: пауза снимается только
  // человеком, поэтому её строка видна везде, а не только в своём подразделе.
  const [settings, reviewCount, autosend] = await Promise.all([
    readAiSettings(actor),
    section === "review" ? Promise.resolve(null) : readAiReview(actor, { filter: "open", documentId: null, limit: 1 }),
    readAiAutosend(actor),
  ]);
  const settingsData = settings.status === "available" ? settings.data : null;
  let reviewOpenCount = reviewCount?.status === "available" ? reviewCount.data.pendingCount : null;

  let content: ReactNode;
  if (section === "documents" && route.documentId) {
    const detail = await readAiDocumentDetail(actor, route.documentId);
    if (detail.status === "missing") notFound();
    if (detail.status !== "available") {
      nextBody = { kind: "unavailable", what: "документ", retryHref };
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
      nextBody = {
        kind: "viewer", detail: detail.data, page: page?.status === "available" ? page.data : null, pageNo,
        pageRead: page === null ? "none" : page.status === "available" ? "available" : page.status === "missing" ? "missing" : "unavailable",
        highlightChunkId: route.chunkId,
      };
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
    const requestIds = {
      upload: randomUUID(),
      retry: requestIdsFor(items.filter((item) => item.status === "failed").map((item) => item.id)),
      company: requestIdsFor(items.filter((item) => item.status === "failed").map((item) => item.id)),
      remove: requestIdsFor(items.map((item) => item.id)),
    };
    nextBody = { kind: "documents", read, preview, requestIds, retryHref, replaceId: route.replaceId, featureOn };
    content = (
      <AiDocumentsView
        read={read}
        preview={preview}
        retryHref={retryHref}
        replaceId={route.replaceId}
        featureOn={featureOn}
        requestIds={requestIds}
      />
    );
  } else if (section === "review") {
    const read = await readAiReview(actor, { filter: route.reviewFilter, documentId: route.documentId, limit: 50 });
    if (read.status === "available" && route.reviewFilter === "open" && !route.documentId) reviewOpenCount = read.data.pendingCount;
    const requestIds = requestIdsFor(read.status === "available" ? read.data.items.map((item) => item.id) : []);
    nextBody = { kind: "review", read, filter: route.reviewFilter, documentId: route.documentId, preview, requestIds, retryHref };
    content = (
      <AiReviewSheet
        read={read}
        filter={route.reviewFilter}
        documentId={route.documentId}
        preview={preview}
        requestIds={requestIds}
        retryHref={retryHref}
      />
    );
  } else if (section === "lab") {
    const [lab, examples] = await Promise.all([readAiLab(actor), readAiExamples(actor)]);
    const labIds = { discard: randomUUID(), reject: randomUUID() };
    const exampleIds = requestIdsFor(examples.status === "available" ? examples.data.items.map((item) => item.id) : []);
    nextBody = { kind: "lab", initial: lab.status === "available" ? lab.data : null, featureOn, preview, requestIds: labIds, examples, exampleIds };
    content = (
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <AiLaboratory
          initial={lab.status === "available" ? lab.data : null}
          featureOn={featureOn}
          preview={preview}
          requestIds={labIds}
        />
        <AiExamplesList
          read={examples}
          preview={preview}
          requestIds={exampleIds}
        />
      </div>
    );
  } else if (section === "rules") {
    const read = await readAiRules(actor);
    const editorRequestId = randomUUID();
    const confirmRequestId = randomUUID();
    nextBody = { kind: "rules", read, preview, editorRequestId, confirmRequestId, retryHref };
    content = (
      <AiRulesView
        read={read}
        preview={preview}
        editorRequestId={editorRequestId}
        confirmRequestId={confirmRequestId}
        retryHref={retryHref}
      />
    );
  } else if (section === "autosend" && route.autosend) {
    const view = route.autosend;
    const [journal, summary] = await Promise.all([
      view.view === "journal" ? readAiAutosendJournal(actor, { filter: view.journalFilter, limit: 100 }) : Promise.resolve(null),
      view.view === "summary" ? readAiAutosendSummary(actor, view.summaryId) : Promise.resolve(null),
    ]);
    if (summary?.status === "missing") notFound();
    const autosendIds = { settings: randomUUID(), toggle: randomUUID(), mode: randomUUID(), pause: randomUUID(), resume: randomUUID() };
    nextBody = { kind: "autosend", read: autosend, route: view, journal, summary, serverOn: aiAutosendServerState() === "on", preview, retryHref, requestIds: autosendIds };
    content = (
      <AiAutosendView
        read={autosend}
        route={view}
        journal={journal}
        summary={summary}
        serverOn={aiAutosendServerState() === "on"}
        preview={preview}
        retryHref={retryHref}
        requestIds={autosendIds}
      />
    );
  } else {
    const [spend, agentStatus] = await Promise.all([readAiSpend(actor), readAiAgentStatus(actor.organizationId)]);
    if (next) nextBody = { kind: "spend", spend, settings, agentStatus, preview, capRequestId: randomUUID(), revokeRequestId: randomUUID(), memoryRequestId: randomUUID(), retryHref };
    content = (
      <AiSpendView
        spend={spend}
        settings={settings}
        agentStatus={agentStatus}
        preview={preview}
        capRequestId={randomUUID()}
        revokeRequestId={randomUUID()}
        memoryRequestId={randomUUID()}
        retryHref={retryHref}
      />
    );
  }

  if (next && nextBody) {
    return (
      <AiAgentNextLazy
        section={section}
        tabs={AI_AGENT_SECTIONS.map((tab) => ({ key: tab.key, label: tab.title, href: aiAgentHref(tab.key), count: tab.key === "review" ? reviewOpenCount : null }))}
        notice={{ settings: settingsData, featureOn, preview, consentRequestId: randomUUID() }}
        pause={section !== "autosend" && autosend.status === "available" && autosend.data.pause
          ? { state: autosend.data, preview, compactHref: aiAgentHref("autosend") } : null}
        hubHref={AI_AGENTS_HUB_HREF}
        body={nextBody}
      />
    );
  }

  return (
    <PartShell
      title="ИИ-агент"
      testId="v3-ai-agent"
      back={(
        <Link href={AI_AGENTS_HUB_HREF} className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-nav t-label text-fg-2 hover:text-fg">
          <Icon name="arrow-left" size={16} /> Все ИИ-агенты
        </Link>
      )}
    >
      <div className="space-y-5">
        <AiAgentNav section={section} reviewOpenCount={reviewOpenCount} />
        <AiAgentNotice settings={settingsData} featureOn={featureOn} preview={preview} consentRequestId={randomUUID()} />
        {section !== "autosend" && autosend.status === "available" ? (
          <AiAutosendPauseBanner state={autosend.data} preview={preview} resumeRequestId="" compactHref={aiAgentHref("autosend")} />
        ) : null}
        {content}
      </div>
    </PartShell>
  );
}
