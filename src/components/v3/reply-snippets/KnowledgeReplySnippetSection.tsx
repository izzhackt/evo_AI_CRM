"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import {
  btnCls,
  btnDangerGhostCls,
  btnGhostCls,
  cn,
  inputCls,
  labelCls,
} from "@/components/ui";
import { Pill } from "@/components/v3/Pill";
import {
  createReplySnippetFormKey,
  replySnippetRowFormKey,
} from "@/components/v3/reply-snippets/reply-snippet-form-keys";
import {
  archivePlatformReplySnippetAction,
  createPlatformReplySnippetAction,
  type PlatformReplySnippetActionState,
  updatePlatformReplySnippetAction,
} from "@/lib/platform-reply-snippet-actions";
import type {
  PlatformReplySnippet,
  PlatformReplySnippetAudience,
} from "@/lib/platform-reply-snippets";

const AUDIENCE_LABELS: Record<PlatformReplySnippetAudience, string> = {
  sales: "Продажи",
  admissions: "Поступление",
  all: "Все роли",
};

const ACTION_MESSAGES: Record<
  Exclude<PlatformReplySnippetActionState["status"], "idle">,
  string
> = {
  saved: "Сохранено. Список обновляется.",
  invalid: "Проверьте название, текст и аудиторию шаблона.",
  forbidden: "У вашей роли нет права на это действие.",
  stale: "Шаблон уже изменён. Обновляем актуальную версию.",
  request_conflict: "Этот запрос уже использован с другими данными. Повторите действие.",
  unavailable: "Шаблоны сейчас недоступны. Изменения не сохранены.",
};

export type KnowledgeReplySnippetItem = Readonly<{
  snippet: PlatformReplySnippet;
  canMutate: boolean;
  updateRequestId: string;
  archiveRequestId: string;
}>;

export type KnowledgeReplySnippetSectionProps = Readonly<{
  items: readonly KnowledgeReplySnippetItem[];
  canManage: boolean;
  availableAudiences: readonly PlatformReplySnippetAudience[];
  createRequestId: string;
}>;

function initialState(
  requestId: string,
  replySnippetId: string | null = null,
): PlatformReplySnippetActionState {
  return {
    status: "idle",
    requestId,
    replySnippetId,
    version: null,
    archivedAt: null,
  };
}

function actionEdge(status: PlatformReplySnippetActionState["status"]): string {
  if (status === "saved") return "v3-edge-ok";
  if (status === "stale" || status === "request_conflict") return "v3-edge-warn";
  return "v3-edge-danger";
}

function ActionFeedback({ state }: Readonly<{ state: PlatformReplySnippetActionState }>) {
  if (state.status === "idle") return null;
  return (
    <p
      role="status"
      className={cn(
        "mt-3 rounded-ctl border border-border border-s-2 bg-surface px-3 py-2 text-sm text-fg-2",
        actionEdge(state.status),
      )}
    >
      {ACTION_MESSAGES[state.status]}
    </p>
  );
}

function useCanonicalRefresh(state: PlatformReplySnippetActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.status]);
}

function CreateSnippetForm({
  requestId,
  audiences,
}: Readonly<{
  requestId: string;
  audiences: readonly PlatformReplySnippetAudience[];
}>) {
  const [state, action, pending] = useActionState(
    createPlatformReplySnippetAction,
    initialState(requestId),
  );
  useCanonicalRefresh(state);
  const locked = pending || state.status === "saved";

  return (
    <form action={action} className="space-y-3" aria-busy={pending}>
      <input type="hidden" name="request_id" value={state.requestId} />
      <label>
        <span className={labelCls}>Кому доступен</span>
        <select name="audience" className={inputCls} disabled={locked}>
          {audiences.map((audience) => (
            <option key={audience} value={audience}>
              {AUDIENCE_LABELS[audience]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={labelCls}>Название</span>
        <input
          name="title"
          required
          className={inputCls}
          disabled={locked}
          autoComplete="off"
        />
      </label>
      <label>
        <span className={labelCls}>Текст ответа</span>
        <textarea
          name="body"
          required
          rows={7}
          className={cn(inputCls, "h-auto min-h-36 py-2")}
          disabled={locked}
        />
      </label>
      <button type="submit" className={btnCls} disabled={locked}>
        {pending ? "Сохраняем…" : "Создать шаблон"}
      </button>
      <ActionFeedback state={state} />
    </form>
  );
}

function SnippetRow({
  item,
  canManage,
  audiences,
}: Readonly<{
  item: KnowledgeReplySnippetItem;
  canManage: boolean;
  audiences: readonly PlatformReplySnippetAudience[];
}>) {
  const { snippet } = item;
  const [updateState, updateAction, updating] = useActionState(
    updatePlatformReplySnippetAction,
    initialState(item.updateRequestId, snippet.replySnippetId),
  );
  const [archiveState, archiveAction, archiving] = useActionState(
    archivePlatformReplySnippetAction,
    initialState(item.archiveRequestId, snippet.replySnippetId),
  );
  useCanonicalRefresh(updateState);
  useCanonicalRefresh(archiveState);
  const updateLocked = updating || updateState.status === "saved";
  const archiveLocked = archiving || archiveState.status === "saved";

  return (
    <li className="border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-fg">{snippet.title}</h3>
            <Pill tone="neutral">
              {AUDIENCE_LABELS[snippet.audience]}
            </Pill>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-fg-2">
            {snippet.body}
          </p>
          <p className="mt-2 text-xs text-fg-3">
            Автор: {snippet.createdByDisplayName}
          </p>
        </div>
      </div>

      {canManage && item.canMutate ? (
        <details className="mt-3">
          <summary className={cn(btnGhostCls, "w-fit cursor-pointer list-none")}>Изменить</summary>
          <div className="mt-3 grid gap-4 border-s-2 border-border ps-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <form action={updateAction} className="grid gap-3" aria-busy={updating}>
              <input type="hidden" name="reply_snippet_id" value={snippet.replySnippetId} />
              <input type="hidden" name="expected_version" value={snippet.version} />
              <input type="hidden" name="request_id" value={updateState.requestId} />
              <label>
                <span className={labelCls}>Кому доступен</span>
                <select
                  name="audience"
                  className={inputCls}
                  defaultValue={snippet.audience}
                  disabled={updateLocked}
                >
                  {audiences.map((audience) => (
                    <option key={audience} value={audience}>
                      {AUDIENCE_LABELS[audience]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={labelCls}>Название</span>
                <input
                  name="title"
                  required
                  className={inputCls}
                  defaultValue={snippet.title}
                  disabled={updateLocked}
                  autoComplete="off"
                />
              </label>
              <label>
                <span className={labelCls}>Текст ответа</span>
                <textarea
                  name="body"
                  required
                  rows={6}
                  className={cn(inputCls, "h-auto min-h-32 py-2")}
                  defaultValue={snippet.body}
                  disabled={updateLocked}
                />
              </label>
              <button type="submit" className={btnCls} disabled={updateLocked}>
                {updating ? "Сохраняем…" : "Сохранить"}
              </button>
              <ActionFeedback state={updateState} />
            </form>

            <form action={archiveAction} className="self-end" aria-busy={archiving}>
              <input type="hidden" name="reply_snippet_id" value={snippet.replySnippetId} />
              <input type="hidden" name="expected_version" value={snippet.version} />
              <input type="hidden" name="request_id" value={archiveState.requestId} />
              <button
                type="submit"
                className={btnDangerGhostCls}
                disabled={archiveLocked}
              >
                {archiving ? "Архивируем…" : "Архивировать"}
              </button>
              <ActionFeedback state={archiveState} />
            </form>
          </div>
        </details>
      ) : null}
    </li>
  );
}

export function KnowledgeReplySnippetSection({
  items,
  canManage,
  availableAudiences,
  createRequestId,
}: KnowledgeReplySnippetSectionProps) {
  return (
    <section
      aria-labelledby="v3-reply-snippets-heading"
      data-testid="v3-knowledge-reply-snippets"
      className="rounded-card border border-border bg-surface"
    >
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h2 id="v3-reply-snippets-heading" className="text-lg font-semibold text-fg">
          Шаблоны ответов
        </h2>
        <p className="mt-1 text-sm leading-5 text-fg-3">
          Готовые тексты для ручной вставки в сообщение. Шаблон никогда не отправляется сам.
        </p>
      </header>

      <div className={cn("grid gap-6 p-4 sm:p-5", canManage && "lg:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)]")}>
        {canManage ? (
          <div>
            <h3 className="mb-3 text-sm font-semibold text-fg">Новый шаблон</h3>
            <CreateSnippetForm
              key={createReplySnippetFormKey(createRequestId)}
              requestId={createRequestId}
              audiences={availableAudiences}
            />
          </div>
        ) : null}

        <div className={cn(canManage && "lg:border-s lg:border-border lg:ps-6")}>
          <h3 className="mb-3 text-sm font-semibold text-fg">Доступные шаблоны</h3>
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-3">Шаблонов пока нет.</p>
          ) : (
            <ul>
              {items.map((item) => (
                <SnippetRow
                  key={replySnippetRowFormKey(
                    item.snippet.replySnippetId,
                    item.updateRequestId,
                    item.archiveRequestId,
                  )}
                  item={item}
                  canManage={canManage}
                  audiences={availableAudiences}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
