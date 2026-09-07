"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import {
  attachPlatformMessageMediaToCaseAction,
  type PlatformMediaAttachActionStatus,
} from "@/lib/platform-media-attach-actions";
import type {
  V3InboxMediaAttachmentContext,
  V3InboxMediaAttachmentSlot,
  V3InboxMessageMedia,
} from "@/lib/v3/inbox-media";

const ATTACH_STATUS_COPY: Readonly<
  Record<Exclude<PlatformMediaAttachActionStatus, "idle">, string>
> = Object.freeze({
  attached: "Вложение добавлено в дело студента.",
  invalid: "Не удалось проверить выбранное вложение или документ.",
  forbidden: "Недостаточно прав для добавления вложения в дело.",
  unsupported_media: "Этот формат нельзя добавить в дело студента.",
  request_conflict: "Запрос уже использован для другого вложения. Повторите действие.",
  stale: "Чеклист изменился. Обновляем доступные документы.",
  upload_in_progress: "Вложение уже добавляется. Дождитесь завершения.",
  reservation_expired: "Время операции истекло. Повторите действие.",
  rate_limited: "Слишком много операций. Попробуйте позже.",
  malware_detected: "Вложение отклонено проверкой безопасности.",
  unavailable: "Вложение или документ сейчас недоступны.",
});

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-9 items-center justify-center rounded-ctl bg-accent px-3 text-xs font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Добавляем…" : "В дело студента"}
    </button>
  );
}

function MediaAttachmentForm({
  media,
  context,
  requestId,
}: Readonly<{
  media: V3InboxMessageMedia;
  context: V3InboxMediaAttachmentContext;
  requestId: string;
}>) {
  const router = useRouter();
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [state, action] = useActionState(
    attachPlatformMessageMediaToCaseAction,
    Object.freeze({
      status: "idle" as const,
      requestId,
      documentVersionId: null,
    }),
  );
  const selectedSlot = context.slots.find(
    (slot) => slot.documentSlotId === selectedSlotId,
  );

  useEffect(() => {
    if (state.status === "attached" || state.status === "stale") {
      router.refresh();
    }
  }, [router, state.status]);

  if (media.mediaId === null || !media.attachable) return null;

  return (
    <form
      action={action}
      className="mt-2 flex flex-col gap-2 border-t border-current/20 pt-2"
      aria-label={`Добавить ${media.fileName ?? "вложение"} в дело студента`}
    >
      <input type="hidden" name="conversation_id" value={context.conversationId} />
      <input type="hidden" name="communication_media_id" value={media.mediaId} />
      <input type="hidden" name="student_case_id" value={context.studentCaseId} />
      <input
        type="hidden"
        name="expected_version"
        value={selectedSlot?.expectedVersion ?? ""}
      />
      <input type="hidden" name="request_id" value={state.requestId} />

      <label className="flex flex-col gap-1 text-2xs font-medium">
        <span>Документ в деле студента</span>
        <select
          name="document_slot_id"
          value={selectedSlotId}
          onChange={(event) => setSelectedSlotId(event.currentTarget.value)}
          className="min-h-10 w-full rounded-ctl border border-border bg-surface px-2 text-xs text-fg"
          required
        >
          <option value="">Выберите документ</option>
          {context.slots.map((slot: V3InboxMediaAttachmentSlot) => (
            <option key={slot.documentSlotId} value={slot.documentSlotId}>
              {slot.label}
            </option>
          ))}
        </select>
      </label>

      {selectedSlot ? <SubmitButton /> : null}
      {state.status !== "idle" ? (
        <p
          className="text-2xs leading-4"
          role={state.status === "attached" ? "status" : "alert"}
        >
          {ATTACH_STATUS_COPY[state.status]}
        </p>
      ) : null}
    </form>
  );
}

export function InboxMessageMedia({
  items,
  inbound,
  attachmentContext,
}: Readonly<{
  items: readonly V3InboxMessageMedia[];
  inbound: boolean;
  attachmentContext: V3InboxMediaAttachmentContext | null;
}>) {
  if (items.length === 0) return null;

  return (
    <ul
      className="mt-2 flex flex-col gap-2"
      aria-label="Вложения к сообщению"
      data-testid="v3-inbox-message-media"
    >
      {items.map((item, index) => {
        const requestId = item.mediaId === null
          ? null
          : attachmentContext?.requestIdsByMediaId[item.mediaId] ?? null;
        const statusTone = inbound ? "text-fg-3" : "text-on-accent";
        return (
          <li
            key={item.mediaId ?? `unavailable-media-${index}`}
            className="min-w-0 border-t border-current/20 pt-2"
          >
            <p className="truncate text-xs font-semibold">
              {item.fileName ?? item.kindLabel}
            </p>
            {item.mimeType || item.fileSizeLabel ? (
              <p className={`mt-0.5 text-2xs ${statusTone}`}>
                {[item.mimeType, item.fileSizeLabel].filter(Boolean).join(" · ")}
              </p>
            ) : null}

            {item.state === "available" && item.previewHref && item.downloadHref ? (
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                <a
                  href={item.previewHref}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Открыть вложение ${item.fileName ?? item.kindLabel}`}
                  className="inline-flex min-h-9 items-center rounded-ctl border border-current px-2.5 hover:opacity-80"
                >
                  Открыть
                </a>
                <a
                  href={item.downloadHref}
                  aria-label={`Скачать вложение ${item.fileName ?? item.kindLabel}`}
                  className="inline-flex min-h-9 items-center rounded-ctl border border-current px-2.5 hover:opacity-80"
                >
                  Скачать
                </a>
              </div>
            ) : (
              <p className={`mt-1 text-2xs leading-4 ${statusTone}`} role="status">
                {item.stateLabel}
              </p>
            )}

            {attachmentContext && requestId ? (
              <MediaAttachmentForm
                key={requestId}
                media={item}
                context={attachmentContext}
                requestId={requestId}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
