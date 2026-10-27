"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  btnCls,
  cn,
  inputCls,
  fieldLabelCls,
} from "@/components/ui";
import { Pill } from "@/components/v3/Pill";
import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";
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

export const AUDIENCE_LABELS: Record<PlatformReplySnippetAudience, string> = {
  sales: "Продажи",
  admissions: "Поступление",
  all: "Все роли",
};

export const ACTION_MESSAGES: Record<
  Exclude<PlatformReplySnippetActionState["status"], "idle">,
  string
> = {
  saved: "Сохранено.",
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

export function initialState(
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

/** Слово итога: «Сохранено» — спокойно, расхождение версий — предупреждение, остальное — проблема. */
function actionTone(status: PlatformReplySnippetActionState["status"]): string {
  if (status === "saved") return "text-fg-2";
  if (status === "stale" || status === "request_conflict") return "text-warn";
  return "text-danger";
}

function ActionFeedback({ state }: Readonly<{ state: PlatformReplySnippetActionState }>) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "saved" ? "status" : "alert"}
      className={cn("mt-3 t-body-compact", actionTone(state.status))}
    >
      {ACTION_MESSAGES[state.status]}
    </p>
  );
}

export function useCanonicalRefresh(state: PlatformReplySnippetActionState) {
  const router = useRouter();
  useEffect(() => {
    if (state.status === "saved" || state.status === "stale") router.refresh();
  }, [router, state.status]);
}

function CreateSnippetForm({
  requestId,
  audiences,
  onCancel,
}: Readonly<{
  requestId: string;
  audiences: readonly PlatformReplySnippetAudience[];
  onCancel: () => void;
}>) {
  const [state, action, pending] = useActionState(
    createPlatformReplySnippetAction,
    initialState(requestId),
  );
  useCanonicalRefresh(state);
  const locked = pending || state.status === "saved";

  return (
    <form action={action} className="grid max-w-xl gap-3" aria-busy={pending}>
      <input type="hidden" name="request_id" value={state.requestId} />
      <label>
        <span className={fieldLabelCls}>Название</span>
        <input
          name="title"
          required
          className={inputCls}
          disabled={locked}
          autoComplete="off"
        />
      </label>
      <label>
        <span className={fieldLabelCls}>Текст ответа</span>
        <textarea
          name="body"
          required
          rows={6}
          className={cn(inputCls, "h-auto min-h-32 py-2")}
          disabled={locked}
        />
      </label>
      <label>
        <span className={fieldLabelCls}>Кому доступен</span>
        <select name="audience" className={inputCls} disabled={locked}>
          {audiences.map((audience) => (
            <option key={audience} value={audience}>
              {AUDIENCE_LABELS[audience]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={QUEUE_CONFIRM} disabled={locked}>
          {pending ? "Сохраняем…" : "Создать шаблон"}
        </button>
        <button type="button" className={QUEUE_SECONDARY} disabled={pending} onClick={onCancel}>
          Отмена
        </button>
      </div>
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
  // Архив не возвращается из этого экрана — как «Удалить…» в других местах: сначала вопрос в строке.
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  return (
    <li id={`reply-snippet-${snippet.replySnippetId}`} className="border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="t-item text-fg">{snippet.title}</h3>
            <Pill tone="neutral">
              {AUDIENCE_LABELS[snippet.audience]}
            </Pill>
          </div>
          <p className="mt-2 whitespace-pre-wrap t-body-compact text-fg-2">
            {snippet.body}
          </p>
          {canManage ? (
            <p className="mt-2 t-meta text-fg-3">
              Автор: {snippet.createdByDisplayName}
            </p>
          ) : null}
        </div>
      </div>

      {canManage && item.canMutate ? (
        <details className="mt-3">
          <summary className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center t-label text-accent-text underline underline-offset-4 hover:text-fg [&::-webkit-details-marker]:hidden">Изменить</summary>
          <div className="mt-1 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <form action={updateAction} className="grid gap-3" aria-busy={updating}>
              <input type="hidden" name="reply_snippet_id" value={snippet.replySnippetId} />
              <input type="hidden" name="expected_version" value={snippet.version} />
              <input type="hidden" name="request_id" value={updateState.requestId} />
              <label>
                <span className={fieldLabelCls}>Кому доступен</span>
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
                <span className={fieldLabelCls}>Название</span>
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
                <span className={fieldLabelCls}>Текст ответа</span>
                <textarea
                  name="body"
                  required
                  rows={6}
                  className={cn(inputCls, "h-auto min-h-32 py-2")}
                  defaultValue={snippet.body}
                  disabled={updateLocked}
                />
              </label>
              <div>
                <button type="submit" className={QUEUE_CONFIRM} disabled={updateLocked}>
                  {updating ? "Сохраняем…" : "Сохранить"}
                </button>
              </div>
              <ActionFeedback state={updateState} />
            </form>

            <form action={archiveAction} className="self-end" aria-busy={archiving}>
              <input type="hidden" name="reply_snippet_id" value={snippet.replySnippetId} />
              <input type="hidden" name="expected_version" value={snippet.version} />
              <input type="hidden" name="request_id" value={archiveState.requestId} />
              {confirmingArchive || archiving ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <p className="t-body-compact text-fg">Архивировать шаблон?</p>
                  <button type="submit" className={QUEUE_CONFIRM} disabled={archiveLocked}>
                    {archiving ? "Архивируем…" : "Архивировать"}
                  </button>
                  <button type="button" className={QUEUE_SECONDARY} disabled={archiving} onClick={() => setConfirmingArchive(false)}>
                    Отмена
                  </button>
                </div>
              ) : (
                <button type="button" className={QUEUE_SECONDARY} onClick={() => setConfirmingArchive(true)}>
                  Архивировать
                </button>
              )}
              <ActionFeedback state={archiveState} />
            </form>
          </div>
        </details>
      ) : null}
    </li>
  );
}

/**
 * Шапка списка: «Новый шаблон» — главное действие страницы (единственная красная кнопка), форма
 * открывается под ней по нажатию, а не стоит пустой рядом со списком. После сохранения приходит новый
 * запрос — ключ шапки меняется, и форма закрывается сама.
 */
function SnippetsHeader({
  canManage,
  standalone,
  requestId,
  audiences,
}: Readonly<{
  canManage: boolean;
  standalone: boolean;
  requestId: string;
  audiences: readonly PlatformReplySnippetAudience[];
}>) {
  const [creating, setCreating] = useState(false);
  if (standalone && !canManage) return null;
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h2 id="v3-reply-snippets-heading" className={cn("t-section text-fg", standalone && "sr-only")}>
          Шаблоны ответов
        </h2>
        {canManage && !creating ? (
          <button type="button" className={btnCls} onClick={() => setCreating(true)}>
            Новый шаблон
          </button>
        ) : null}
      </header>
      {canManage && creating ? (
        <div className="border-b border-border p-4 sm:p-5">
          <CreateSnippetForm requestId={requestId} audiences={audiences} onCancel={() => setCreating(false)} />
        </div>
      ) : null}
    </>
  );
}

export function KnowledgeReplySnippetSection({
  items,
  canManage,
  availableAudiences,
  createRequestId,
  standalone = false,
}: KnowledgeReplySnippetSectionProps & Readonly<{
  /** Страница без раздела «База знаний» вокруг: её заголовок уже называет шаблоны, второй не нужен. */
  standalone?: boolean;
}>) {
  return (
    <section
      aria-label={standalone ? "Шаблоны ответов" : undefined}
      aria-labelledby={standalone ? undefined : "v3-reply-snippets-heading"}
      data-testid="v3-knowledge-reply-snippets"
      className="rounded-card border border-border bg-surface"
    >
      <SnippetsHeader
        key={createReplySnippetFormKey(createRequestId)}
        canManage={canManage}
        standalone={standalone}
        requestId={createRequestId}
        audiences={availableAudiences}
      />
      <div className="p-4 sm:p-5">
        {items.length === 0 ? (
          <p className="py-6 text-center t-body-compact text-fg-3">Шаблонов пока нет.</p>
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
    </section>
  );
}
