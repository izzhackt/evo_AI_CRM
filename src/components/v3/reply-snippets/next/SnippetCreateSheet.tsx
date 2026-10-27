"use client";

import { PlusIcon } from "lucide-react";
import { useActionState } from "react";

import { DetailSheet } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { sheetEscape } from "@/components/v3/panel/sheet-escape";
import { QUEUE_CONFIRM } from "@/components/v3/queue/queue-buttons";
import { createPlatformReplySnippetAction } from "@/lib/platform-reply-snippet-actions";
import type { PlatformReplySnippetAudience } from "@/lib/platform-reply-snippets";

import { initialState, useCanonicalRefresh } from "../KnowledgeReplySnippetSection";
import { SnippetFeedback, SnippetFields } from "./SnippetFields";

function CreateForm({ requestId, audiences }: Readonly<{ requestId: string; audiences: readonly PlatformReplySnippetAudience[] }>) {
  const [state, action, pending] = useActionState(createPlatformReplySnippetAction, initialState(requestId));
  useCanonicalRefresh(state);
  const locked = pending || state.status === "saved";
  return (
    <form action={action} className="grid gap-4" aria-busy={pending}>
      <input type="hidden" name="request_id" value={state.requestId} />
      <SnippetFields audiences={audiences} disabled={locked} />
      <div><button type="submit" className={QUEUE_CONFIRM} disabled={locked}>{pending ? "Сохраняем…" : "Создать шаблон"}</button></div>
      <SnippetFeedback state={state} />
    </form>
  );
}

/**
 * «Новый шаблон» — главное действие раздела (единственная красная кнопка): форма открывается в панели. После сохранения
 * приходит новый запрос — страница меняет `key` кнопки, и панель закрывается сама (как закрывалась прежняя форма).
 */
export function SnippetCreateSheet({ requestId, audiences }: Readonly<{ requestId: string; audiences: readonly PlatformReplySnippetAudience[] }>) {
  return (
    <DetailSheet title="Новый шаблон" onEscapeKeyDown={sheetEscape} trigger={<Button><PlusIcon aria-hidden="true" />Новый шаблон</Button>}>
      <CreateForm requestId={requestId} audiences={audiences} />
    </DetailSheet>
  );
}
