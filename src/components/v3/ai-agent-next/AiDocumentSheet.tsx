"use client";

import Link from "next/link";

import { KeyFacts, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { AiActionForm } from "@/components/v3/ai-agent/AiActionForm";
import { confirmAiDocumentCompanyAction, deleteAiDocumentAction, retryAiDocumentAction } from "@/lib/platform-ai-agent-actions";
import { AI_PERSONAL_DOCUMENT_CODE, AUDIENCE_LABEL, aiAgentHref, aiDateTime, documentStatus, type AiDocument } from "@/lib/v3/ai-agent";

import { AI_OUTLINE_BUTTON } from "./ai-buttons";
import { documentDay, LIVE, plural, sourceLine } from "./ai-document-model";
import type { AiDocumentRequestIds } from "./ai-agent-next-types";

export const STATUS_TONE = { ok: "ok", warn: "warn", danger: "danger", muted: "neutral" } as const;

function Delete({ document, requestId, label }: Readonly<{ document: AiDocument; requestId: string; label: string }>) {
  return (
    <AiActionForm
      requestId={requestId}
      action={deleteAiDocumentAction}
      fields={{ document_id: document.id, expected_version: String(document.rowVersion) }}
      label={label}
      pendingLabel="Удаляю…"
      buttonClassName={AI_OUTLINE_BUTTON}
      messages={{ saved: "Документ удалён.", conflict: "Документ уже изменился — обновите страницу." }}
    />
  );
}

/** Команды документа, что ждут сотрудника: «Повторить» у ошибки, «Это материал компании — продолжить» у документа, похожего на документ клиента, и удаление. */
function Commands({ document, requestIds }: Readonly<{ document: AiDocument; requestIds: AiDocumentRequestIds }>) {
  if (document.status !== "failed") return null;
  const personal = document.errorCode === AI_PERSONAL_DOCUMENT_CODE;
  const fields = { document_id: document.id, expected_version: String(document.rowVersion) };
  return (
    <div className="flex flex-wrap items-start gap-2">
      {personal && requestIds.company[document.id] ? (
        <AiActionForm requestId={requestIds.company[document.id]!} action={confirmAiDocumentCompanyAction} fields={fields} label="Это материал компании — продолжить"
          pendingLabel="Записываю решение…" buttonClassName={AI_OUTLINE_BUTTON} testId="v3-ai-document-company"
          messages={{ saved: "Решение записано — обработка продолжается.", conflict: "Документ уже изменился — обновите страницу." }} />
      ) : null}
      {!personal && requestIds.retry[document.id] ? (
        <AiActionForm requestId={requestIds.retry[document.id]!} action={retryAiDocumentAction} fields={fields} label="Повторить" pendingLabel="Ставлю в очередь…"
          buttonClassName={AI_OUTLINE_BUTTON} messages={{ saved: "Документ снова в очереди." }} />
      ) : null}
      {requestIds.remove[document.id] ? <Delete document={document} requestId={requestIds.remove[document.id]!} label={personal ? "Удалить файл" : "Удалить документ"} /> : null}
    </div>
  );
}

/**
 * Материал в панели: источник, для кого, состояние, объём и дата; предупреждение о документе клиента и код ошибки остаются на виду; команды,
 * что ждут сотрудника, — «Повторить» / «Продолжить» и «Удалить»; у готового загруженного файла — «Загрузить новую версию». Преемник
 * (новая версия, пока не готова) назван: пока он обрабатывается, ищется прежний.
 */
export function AiDocumentSheet({ document, successor, canManage, requestIds }: Readonly<{ document: AiDocument; successor: AiDocument | null; canManage: boolean; requestIds: AiDocumentRequestIds }>) {
  const status = documentStatus(document);
  const personal = document.status === "failed" && document.errorCode === AI_PERSONAL_DOCUMENT_CODE;
  const allowNewVersion = document.source === "upload" && LIVE.has(document.status) && successor === null;
  const pending = successor !== null && successor.status !== "failed";
  const successorStatus = successor ? documentStatus(successor) : null;
  return (
    <div className="grid gap-5" data-testid="v3-ai-document" data-status={document.status} data-document-id={document.id}>
      <KeyFacts columns={2} facts={[
        { label: "Состояние", value: <StatusBadge tone={STATUS_TONE[status.tone]} label={status.label} wrap /> },
        { label: "Для кого", value: AUDIENCE_LABEL[document.audience] },
        { label: "Источник", value: sourceLine(document) },
        { label: "Объём", value: [document.pageCount ? plural(document.pageCount, "страница", "страницы", "страниц") : null, document.chunkCount > 0 ? plural(document.chunkCount, "фрагмент", "фрагмента", "фрагментов") : null].filter(Boolean).join(" · ") || null },
        { label: "Обновлён", value: <span className="tabular-nums">{documentDay(document.updatedAt)}</span> },
      ]} />
      {personal ? <p role="alert" className="t-body-compact text-fg-2">В тексте есть признаки паспорта, ПИН или бланка аттестата. Документы клиентов агенту не загружаются — продолжайте, только если это материал компании.</p> : null}
      {document.status === "failed" && !personal && document.errorCode ? <p className="t-meta text-fg-3">Код: <span className="font-mono">{document.errorCode}</span></p> : null}
      {document.status === "review" && document.openReviewCount > 0 ? <div><Button variant="outline" asChild><Link href={aiAgentHref("review", { document: document.id })}>Открыть «Лист сверки»</Link></Button></div> : null}
      {successor && successorStatus ? (
        <div className="grid gap-2 rounded-ctl bg-surface-2 px-3 py-2" data-testid="v3-ai-document-successor" data-status={successor.status}>
          <p className="t-body-compact text-fg-2">
            {pending ? "Новая версия обрабатывается — пока ищется прежняя." : "Новая версия не обработана — ищется прежняя."}
            <span className="t-meta text-fg-3"> · {aiDateTime(successor.updatedAt)}</span>
          </p>
          <StatusBadge tone={STATUS_TONE[successorStatus.tone]} label={successorStatus.label} wrap />
          {canManage ? <Commands document={successor} requestIds={requestIds} /> : null}
        </div>
      ) : null}
      {canManage ? <Commands document={document} requestIds={requestIds} /> : null}
      <div className="flex flex-wrap items-start gap-2">
        <Button variant="outline" asChild><Link href={aiAgentHref("documents", { document: document.id })}>Открыть материал</Link></Button>
        {canManage && allowNewVersion ? <Button variant="outline" asChild><Link href={aiAgentHref("documents", { replace: document.id })}>Загрузить новую версию</Link></Button> : null}
        {canManage && document.status !== "failed" && requestIds.remove[document.id]
          ? <Delete document={document} requestId={requestIds.remove[document.id]!} label="Удалить — агент перестанет его использовать" /> : null}
      </div>
    </div>
  );
}
