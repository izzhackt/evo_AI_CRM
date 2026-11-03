import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";

import type { AiAgentNextBody } from "@/components/staff/ai-agent-next/ai-agent-next-types";
import { AiAgentNextLazy } from "@/components/staff/ai-agent-next/AiAgentNextLazy";
import { isStaffPreview } from "@/lib/platform-access";
import { requireV3PageActor } from "@/lib/platform-guards";
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
  const actor = await requireV3PageActor("/ai-agent");
  const route = parseAiAgentRoute(await searchParams);
  if (!route) notFound();
  const { section } = route;
  const preview = isStaffPreview(actor);
  const featureOn = aiAgentFeatureOn();
  // «Новый вид» — единственный вид (#1327): содержимое подраздела уходит входу данными.
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

  if (section === "documents" && route.documentId) {
    const detail = await readAiDocumentDetail(actor, route.documentId);
    if (detail.status === "missing") notFound();
    if (detail.status !== "available") {
      nextBody = { kind: "unavailable", what: "документ", retryHref };
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
  } else if (section === "review") {
    const read = await readAiReview(actor, { filter: route.reviewFilter, documentId: route.documentId, limit: 50 });
    if (read.status === "available" && route.reviewFilter === "open" && !route.documentId) reviewOpenCount = read.data.pendingCount;
    const requestIds = requestIdsFor(read.status === "available" ? read.data.items.map((item) => item.id) : []);
    nextBody = { kind: "review", read, filter: route.reviewFilter, documentId: route.documentId, preview, requestIds, retryHref };
  } else if (section === "lab") {
    const [lab, examples] = await Promise.all([readAiLab(actor), readAiExamples(actor)]);
    const labIds = { discard: randomUUID(), reject: randomUUID() };
    const exampleIds = requestIdsFor(examples.status === "available" ? examples.data.items.map((item) => item.id) : []);
    nextBody = { kind: "lab", initial: lab.status === "available" ? lab.data : null, featureOn, preview, requestIds: labIds, examples, exampleIds };
  } else if (section === "rules") {
    const read = await readAiRules(actor);
    const editorRequestId = randomUUID();
    const confirmRequestId = randomUUID();
    nextBody = { kind: "rules", read, preview, editorRequestId, confirmRequestId, retryHref };
  } else if (section === "autosend" && route.autosend) {
    const view = route.autosend;
    const [journal, summary] = await Promise.all([
      view.view === "journal" ? readAiAutosendJournal(actor, { filter: view.journalFilter, limit: 100 }) : Promise.resolve(null),
      view.view === "summary" ? readAiAutosendSummary(actor, view.summaryId) : Promise.resolve(null),
    ]);
    if (summary?.status === "missing") notFound();
    const autosendIds = { settings: randomUUID(), toggle: randomUUID(), mode: randomUUID(), pause: randomUUID(), resume: randomUUID() };
    nextBody = { kind: "autosend", read: autosend, route: view, journal, summary, serverOn: aiAutosendServerState() === "on", preview, retryHref, requestIds: autosendIds };
  } else {
    const [spend, agentStatus] = await Promise.all([readAiSpend(actor), readAiAgentStatus(actor.organizationId)]);
    nextBody = { kind: "spend", spend, settings, agentStatus, preview, capRequestId: randomUUID(), revokeRequestId: randomUUID(), memoryRequestId: randomUUID(), retryHref };
  }

  if (nextBody === null) notFound();
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
