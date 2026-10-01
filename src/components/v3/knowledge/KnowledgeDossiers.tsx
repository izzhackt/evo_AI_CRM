"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlatformStudentCaseQueueRow } from "@/lib/platform-admissions";
import type { PlatformCaseDocumentWorkspace } from "@/lib/platform-private-documents";
import { appendOlderCaseChatPage, type CaseChatPage } from "@/lib/platform-case-chat-contract";
import type { ProfileEvent } from "@/components/v3/profile/types";
import { Icon } from "@/components/icons";
import { SkeletonBlock } from "@/components/ui";
import { journalEvent } from "@/lib/v3/wording";
import { QUEUE_SECONDARY } from "../queue/queue-buttons";
import { knowledgeFetch, command } from "./client";
import { KnowledgeCaseDocuments } from "./KnowledgeCaseDocuments";
import { KnowledgeExport } from "./KnowledgeExport";
import { KB_ERROR, KB_QUIET, knowledgeMoment } from "./knowledge-look";

const TAB = "v3-choice inline-flex min-h-11 items-center rounded-nav px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

type Directory = { items: PlatformStudentCaseQueueRow[]; hasMore: boolean; nextCursor: { sortAt: string; id: string } | null };
type History = { events: ProfileEvent[]; nextCursor: { at: string; id: string } | null };
export function KnowledgeDossiers({ caseId, search }: { caseId?: string | null; search: string }) {
  const router = useRouter(); const [directory, setDirectory] = useState<Directory | null>(null);
  const [record, setRecord] = useState<PlatformStudentCaseQueueRow | null>(null);
  const [documents, setDocuments] = useState<PlatformCaseDocumentWorkspace | null>(null);
  const [chat, setChat] = useState<CaseChatPage | null>(null); const [history, setHistory] = useState<History | null>(null);
  const [tab, setTab] = useState<"documents" | "chat" | "history">("documents");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError("");
    try {
      if (!caseId) setDirectory(await knowledgeFetch<Directory>(`clients?${new URLSearchParams({ search })}`, { signal }));
      else {
        const current = await knowledgeFetch<PlatformStudentCaseQueueRow>(`clients/${caseId}`, { signal });
        setRecord(current);
        if (tab === "documents") setDocuments(current.handoffAt && ["active", "closed"].includes(current.state) ? await knowledgeFetch<PlatformCaseDocumentWorkspace>(`clients/${caseId}/documents`, { signal }) : null);
        if (tab === "chat") { setChat(await knowledgeFetch<CaseChatPage>(`clients/${caseId}/chat`, { signal })); setLoadedAt(new Date()); }
        if (tab === "history") setHistory(await knowledgeFetch<History>(`clients/${caseId}/history`, { signal }));
      }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить материалы клиента."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [caseId, search, tab]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [load]);
  async function more() {
    setBusy(true); setError("");
    try {
      if (!caseId && directory?.nextCursor) {
        const next = await knowledgeFetch<Directory>(`clients?${new URLSearchParams({ search, afterAt: directory.nextCursor.sortAt, afterId: directory.nextCursor.id })}`);
        if (next.hasMore && next.nextCursor?.id === directory.nextCursor.id) throw new Error("Список не продолжился. Обновите страницу.");
        setDirectory({ ...next, items: [...directory.items, ...next.items] });
      } else if (tab === "chat" && chat?.hasMore) {
        const next = await knowledgeFetch<CaseChatPage>(`clients/${caseId}/chat?before=${encodeURIComponent(chat.cursor)}`);
        if (next.hasMore && next.cursor === chat.cursor) throw new Error("Переписка не продолжилась. Обновите страницу.");
        setChat(appendOlderCaseChatPage(chat, next));
      } else if (tab === "history" && history?.nextCursor) {
        const next = await knowledgeFetch<History>(`clients/${caseId}/history?${new URLSearchParams({ beforeAt: history.nextCursor.at, beforeId: history.nextCursor.id })}`);
        setHistory({ ...next, events: [...history.events, ...next.events] });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить продолжение."); }
    finally { setBusy(false); }
  }
  async function openManual() {
    if (!record) return;
    setBusy(true); setError("");
    try {
      const folder = await command({ op: "create", area: "clients", kind: "folder", title: record.studentDisplayName,
        caseId: record.studentCaseId, sourceKey: `case:${record.studentCaseId}`, source: { canonicalCaseId: record.studentCaseId } });
      router.push(`/v3/knowledge?area=clients&folder=${folder.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось открыть папку."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 pb-4" aria-busy={busy} data-testid="knowledge-dossiers">
    {error && <p className={KB_ERROR} role="alert">{error}<button type="button" className={QUEUE_SECONDARY} onClick={() => void load()}>Повторить</button></p>}
    {!caseId ? <>
      <h2 className="t-section">Клиенты</h2>
      {!directory && !error ? <ul aria-hidden="true" className="divide-y divide-border border-y border-border">{[0, 1, 2].map((index) => <li key={index} className="flex min-h-11 items-center py-2"><SkeletonBlock className={`h-3.5 rounded-nav ${index % 2 ? "w-1/3" : "w-1/2"}`} /></li>)}</ul> : null}
      {directory && !directory.items.length && <p className="t-body-compact text-fg-2">По запросу ничего не найдено.</p>}
      {directory?.items.length ? <ul className="divide-y divide-border border-y border-border">{directory.items.map((item) => <li key={item.studentCaseId} className="grid gap-x-3 py-1 @xl/kbl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] @xl/kbl:items-center">
        <Link href={`/v3/knowledge?area=clients&case=${item.studentCaseId}`} className="flex min-h-11 items-center t-item text-fg underline-offset-4 hover:underline [overflow-wrap:anywhere]">{item.studentDisplayName}</Link>
        <span className="t-body-compact text-fg-2">{[item.targetCountry, item.targetDegree, item.intake].filter(Boolean).join(" · ")}</span>
        <span className="t-meta text-fg-3">Дело <span className="font-mono">{item.studentCaseId.slice(0, 8)}</span></span>
      </li>)}</ul> : null}
      {directory?.hasMore && <button type="button" className={KB_QUIET} disabled={busy} onClick={() => void more()}>Показать ещё клиентов</button>}
    </> : <>
      <Link href="/v3/knowledge?area=clients" className={KB_QUIET}><Icon name="arrow-left" size={16} />Клиенты</Link>
      {record ? <h2 className="t-record-title [overflow-wrap:anywhere]">{record.studentDisplayName}</h2> : <><p role="status" className="sr-only">Загружаем досье…</p><SkeletonBlock className="h-7 w-64 max-w-full rounded-nav" /></>}
      <div className="flex flex-wrap gap-2">
        <Link href={`/v3/profile?case=${caseId}`} className={QUEUE_SECONDARY}>Открыть дело</Link>
        <button type="button" className={QUEUE_SECONDARY} disabled={busy || !record} onClick={() => void openManual()}>Добавленные материалы</button>
        <KnowledgeExport caseIds={[caseId]} label="Выгрузить досье" />
      </div>
      <div className="flex flex-wrap gap-1 border-b border-border pb-1" role="group" aria-label="Материалы клиента">
        {(["documents", "chat", "history"] as const).map((key) => <button type="button" key={key} className={TAB} aria-pressed={tab === key} onClick={() => setTab(key)}>{({ documents: "Документы", chat: "Переписка", history: "История" })[key]}</button>)}
      </div>
      {tab === "documents" && record && !record.handoffAt && <p className="t-body-compact text-fg-2">Рабочий список документов появится после передачи дела.</p>}
      {tab === "documents" && documents && <KnowledgeCaseDocuments key={caseId} caseId={caseId} documents={documents} />}
      {tab === "chat" && chat && <>
        {chat.hasMore && <button disabled={busy} type="button" className={KB_QUIET} onClick={() => void more()}>Загрузить предыдущие сообщения</button>}
        {!chat.messages.length && <p className="t-body-compact text-fg-2">Переписки пока нет.</p>}
        <ol className="divide-y divide-border border-y border-border">{chat.messages.map((message) => {
          const at = loadedAt ? knowledgeMoment(message.createdAt, loadedAt) : null;
          return <li key={message.id} className="space-y-1 py-3">
            <p className="flex flex-wrap items-baseline gap-x-2"><span className="t-item text-fg">{message.authorName}</span>{at ? <time dateTime={message.createdAt} className="t-meta text-fg-3"><span className="font-mono">{at}</span></time> : null}</p>
            <p className="max-w-[70ch] whitespace-pre-wrap t-body text-fg">{message.body}</p>
            {message.attachmentId && <Link href={`/v3/profile?case=${caseId}&tab=${message.attachmentKind === "document" ? "documents" : "overview"}`} className={KB_QUIET}>{message.attachmentLabel ?? "Вложение"}</Link>}
          </li>;
        })}</ol>
      </>}
      {tab === "history" && history && <>
        {!history.events.length && <p className="t-body-compact text-fg-2">История пока пуста.</p>}
        <ul className="divide-y divide-border border-y border-border">{history.events.map((event) => <li key={event.id} className="flex flex-wrap items-center gap-x-3 py-1 t-body-compact">
          <Link href={event.href ?? `/v3/profile?case=${caseId}`} className="inline-flex min-h-11 items-center text-fg underline-offset-4 hover:underline">{journalEvent(event.transition) ?? event.transition}</Link>
          {event.at ? <span className="font-mono text-fg-3">{event.at}</span> : null}
        </li>)}</ul>
        {history.nextCursor && <button type="button" className={KB_QUIET} disabled={busy} onClick={() => void more()}>Показать ещё события</button>}
      </>}
    </>}
  </section>;
}
