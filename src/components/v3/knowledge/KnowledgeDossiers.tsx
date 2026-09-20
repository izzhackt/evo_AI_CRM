"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlatformStudentCaseQueueRow } from "@/lib/platform-admissions";
import type { PlatformCaseDocumentWorkspace } from "@/lib/platform-private-documents";
import type { CaseChatPage } from "@/lib/platform-case-chat-contract";
import type { ProfileEvent } from "@/components/v3/profile/types";
import { journalEvent } from "@/lib/v3/wording";
import { knowledgeFetch, command } from "./client";
import { KnowledgeCaseDocuments } from "./KnowledgeCaseDocuments";
import { KnowledgeExport } from "./KnowledgeExport";
import styles from "./KnowledgeLibrary.module.css";

type Directory = { items: PlatformStudentCaseQueueRow[]; hasMore: boolean; nextCursor: { sortAt: string; id: string } | null };
type History = { events: ProfileEvent[]; nextCursor: { at: string; id: string } | null };
export function KnowledgeDossiers({ caseId, search }: { caseId?: string | null; search: string }) {
  const router = useRouter(); const [directory, setDirectory] = useState<Directory | null>(null);
  const [record, setRecord] = useState<PlatformStudentCaseQueueRow | null>(null);
  const [documents, setDocuments] = useState<PlatformCaseDocumentWorkspace | null>(null);
  const [chat, setChat] = useState<CaseChatPage | null>(null); const [history, setHistory] = useState<History | null>(null);
  const [tab, setTab] = useState<"documents" | "chat" | "history">("documents");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError("");
    try {
      if (!caseId) setDirectory(await knowledgeFetch<Directory>(`clients?${new URLSearchParams({ search })}`, { signal }));
      else {
        const current = await knowledgeFetch<PlatformStudentCaseQueueRow>(`clients/${caseId}`, { signal });
        setRecord(current);
        if (tab === "documents") setDocuments(current.handoffAt && ["active", "closed"].includes(current.state) ? await knowledgeFetch<PlatformCaseDocumentWorkspace>(`clients/${caseId}/documents`, { signal }) : null);
        if (tab === "chat") setChat(await knowledgeFetch<CaseChatPage>(`clients/${caseId}/chat`, { signal }));
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
        setChat({ ...next, messages: [...next.messages, ...chat.messages] });
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
  return <section className={styles.dossiers} aria-busy={busy}>
    {error && <p className={styles.error} role="alert">{error}<button type="button" onClick={() => void load()}>Повторить</button></p>}
    {!caseId ? <>
      <h2>Клиенты</h2>
      {directory && !directory.items.length && <p>По запросу ничего не найдено.</p>}
      <ul className={styles.clientList}>{directory?.items.map((item) => <li key={item.studentCaseId}>
        <Link href={`/v3/knowledge?area=clients&case=${item.studentCaseId}`}>{item.studentDisplayName}</Link>
        <span>{[item.targetCountry, item.targetDegree, item.intake].filter(Boolean).join(" · ")}</span>
        <small>Дело {item.studentCaseId.slice(0, 8)}</small>
      </li>)}</ul>
      {directory?.hasMore && <button type="button" disabled={busy} onClick={() => void more()}>Показать ещё клиентов</button>}
    </> : <>
      <Link href="/v3/knowledge?area=clients">← Клиенты</Link>
      <KnowledgeExport caseIds={[caseId]} label="Выгрузить досье" />
      <h2>{record?.studentDisplayName ?? "Загрузка досье…"}</h2>
      <div className={styles.actions}>
        <Link href={`/v3/profile?case=${caseId}`}>Открыть дело</Link>
        <button type="button" disabled={busy || !record} onClick={() => void openManual()}>Добавленные материалы</button>
      </div>
      <div className={styles.actions} role="group" aria-label="Материалы клиента">
        {(["documents", "chat", "history"] as const).map((key) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{({ documents: "Документы", chat: "Переписка", history: "История" })[key]}</button>)}
      </div>
      {tab === "documents" && record && !record.handoffAt && <p>Рабочий список документов появится после передачи дела.</p>}
      {tab === "documents" && documents && <KnowledgeCaseDocuments key={caseId} caseId={caseId} documents={documents} />}
      {tab === "chat" && chat && <>
        {chat.hasMore && <button disabled={busy} type="button" onClick={() => void more()}>Загрузить предыдущие сообщения</button>}
        {!chat.messages.length && <p>Переписки пока нет.</p>}
        <ol className={styles.messages}>{chat.messages.map((message) => <li key={message.id}>
          <strong>{message.authorName}</strong><time>{new Date(message.createdAt).toLocaleString("ru-RU")}</time>
          <p>{message.body}</p>{message.attachmentId && <Link href={`/v3/profile?case=${caseId}&tab=${message.attachmentKind === "document" ? "documents" : "overview"}`}>{message.attachmentLabel ?? "Вложение"}</Link>}
        </li>)}</ol>
      </>}
      {tab === "history" && history && <>
        {!history.events.length && <p>История пока пуста.</p>}
        <ul>{history.events.map((event) => <li key={event.id}><Link href={event.href ?? `/v3/profile?case=${caseId}`}>{journalEvent(event.transition) ?? event.transition}</Link> {event.at}</li>)}</ul>
        {history.nextCursor && <button type="button" disabled={busy} onClick={() => void more()}>Показать ещё события</button>}
      </>}
    </>}
  </section>;
}
