"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";
import { archivePlatformReplySnippetAction, updatePlatformReplySnippetAction } from "@/lib/platform-reply-snippet-actions";
import type { PlatformReplySnippetAudience } from "@/lib/platform-reply-snippets";

import { useConfirmStep } from "../../knowledge/next/useConfirmStep";
import { initialState, useCanonicalRefresh, type KnowledgeReplySnippetItem } from "../KnowledgeReplySnippetSection";
import { SnippetFeedback, SnippetFields } from "./SnippetFields";

/** Редактирование и архив: те же действия, `expected_version` и request_id, что у прежней строки. Архив спрашивает сначала. */
function EditForms({ item, audiences }: Readonly<{ item: KnowledgeReplySnippetItem; audiences: readonly PlatformReplySnippetAudience[] }>) {
  const { snippet } = item;
  const [updateState, updateAction, updating] = useActionState(updatePlatformReplySnippetAction, initialState(item.updateRequestId, snippet.replySnippetId));
  const [archiveState, archiveAction, archiving] = useActionState(archivePlatformReplySnippetAction, initialState(item.archiveRequestId, snippet.replySnippetId));
  useCanonicalRefresh(updateState);
  useCanonicalRefresh(archiveState);
  const { asking, questionId, trigger, confirm, ask } = useConfirmStep();
  const updateLocked = updating || updateState.status === "saved";
  const archiveLocked = archiving || archiveState.status === "saved";
  return (
    <div className="grid gap-6">
      <form action={updateAction} className="grid gap-4" aria-busy={updating}>
        <input type="hidden" name="reply_snippet_id" value={snippet.replySnippetId} />
        <input type="hidden" name="expected_version" value={snippet.version} />
        <input type="hidden" name="request_id" value={updateState.requestId} />
        <SnippetFields audiences={audiences} disabled={updateLocked} defaults={snippet} />
        <div><button type="submit" className={QUEUE_CONFIRM} disabled={updateLocked}>{updating ? "Сохраняем…" : "Сохранить"}</button></div>
        <SnippetFeedback state={updateState} />
      </form>
      <form action={archiveAction} className="grid gap-3 border-t border-border pt-4" aria-busy={archiving}>
        <input type="hidden" name="reply_snippet_id" value={snippet.replySnippetId} />
        <input type="hidden" name="expected_version" value={snippet.version} />
        <input type="hidden" name="request_id" value={archiveState.requestId} />
        {asking || archiving ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p id={questionId} className="t-body-compact text-fg">Архивировать шаблон?</p>
            <button ref={confirm} type="submit" aria-describedby={questionId} className={QUEUE_CONFIRM} disabled={archiveLocked}>{archiving ? "Архивируем…" : "Архивировать"}</button>
            <Button type="button" variant="outline" disabled={archiving} onClick={() => ask(false)}>Отмена</Button>
          </div>
        ) : <div><Button ref={trigger} type="button" variant="outline" onClick={() => ask(true)}>Архивировать</Button></div>}
        <SnippetFeedback state={archiveState} />
      </form>
    </div>
  );
}

/**
 * Панель шаблона: текст целиком; у кого есть право менять — формы под ним; автор виден тем, кто управляет шаблонами — в обоих случаях
 * (колонка «Автор» таблицы показывается только в широком блоке, а сведения из неё должны быть и в панели записи).
 */
export function SnippetSheetBody({ item, canManage, audiences }: Readonly<{ item: KnowledgeReplySnippetItem; canManage: boolean; audiences: readonly PlatformReplySnippetAudience[] }>) {
  const { snippet } = item;
  const author = canManage ? <p className="t-meta text-fg-3">Автор: {snippet.createdByDisplayName}</p> : null;
  if (canManage && item.canMutate) return <div className="grid gap-4">{author}<EditForms item={item} audiences={audiences} /></div>;
  return (
    <div className="grid gap-3">
      <p className="t-body-compact whitespace-pre-wrap text-fg-2">{snippet.body}</p>
      {author}
    </div>
  );
}
