"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  reconcilePlatformWhatsAppSendAction,
  requestPlatformGeminiProposalAction,
  reviewPlatformGeminiProposalAction,
  sendPlatformWhatsAppMessageAction,
  type PlatformGeminiRequestActionState,
  type PlatformGeminiReviewActionState,
  type PlatformWhatsAppReconcileActionState,
  type PlatformWhatsAppSendActionState,
} from "@/lib/platform-provider-actions";
import type {
  PlatformGeminiProposalReview,
  PlatformManualWhatsAppSendAttempt,
  PlatformStaffGeminiProposal,
} from "@/lib/platform-provider-workflows";

const BUTTON_CLASS =
  "inline-flex min-h-10 items-center justify-center rounded-ctl bg-accent px-3 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-fg-3";
const SECONDARY_BUTTON_CLASS =
  "inline-flex min-h-10 items-center justify-center rounded-ctl border border-control-edge bg-surface px-3 text-sm font-semibold text-fg-2 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";
const DANGER_BUTTON_CLASS =
  "inline-flex min-h-10 items-center justify-center rounded-ctl border border-danger/30 bg-surface px-3 text-sm font-semibold text-danger hover:bg-danger-weak disabled:cursor-not-allowed disabled:opacity-50";
const FIELD_CLASS =
  "mt-1 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-sm leading-6 text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/10";

const INITIAL_GEMINI_STATE: PlatformGeminiRequestActionState = Object.freeze({
  status: "idle",
  failureCode: null,
});
const INITIAL_REVIEW_STATE: PlatformGeminiReviewActionState = Object.freeze({
  status: "idle",
  decision: null,
});
const INITIAL_SEND_STATE: PlatformWhatsAppSendActionState = Object.freeze({
  status: "idle",
});
const INITIAL_RECONCILE_STATE: PlatformWhatsAppReconcileActionState =
  Object.freeze({ status: "idle" });

const GEMINI_STATUS: Record<
  Exclude<PlatformGeminiRequestActionState["status"], "idle">,
  string
> = {
  proposal_ready: "Черновик сохранён и ждёт решения сотрудника.",
  human_review: "Gemini не дал безопасный результат. Ответ подготовит сотрудник.",
  in_progress: "Этот запрос уже выполняется.",
  blocked: "Gemini не настроен на сервере.",
  invalid: "Не удалось подтвердить последнее входящее сообщение.",
  unavailable: "Gemini сейчас недоступен. Черновик не создан.",
};

const REVIEW_STATUS: Record<
  Exclude<PlatformGeminiReviewActionState["status"], "idle">,
  string
> = {
  reviewed: "Решение сотрудника сохранено.",
  invalid: "Проверьте текст и причину решения.",
  unavailable: "Решение не сохранено. Обновите страницу и проверьте состояние.",
};

const SEND_STATUS: Record<
  Exclude<PlatformWhatsAppSendActionState["status"], "idle">,
  string
> = {
  succeeded: "WhatsApp принял одно сообщение; результат сохранён.",
  unknown_result:
    "Результат неизвестен. Повторная отправка заблокирована до безопасной проверки.",
  terminal_error:
    "WhatsApp отклонил отправку. Автоматического повтора не было.",
  not_claimed:
    "Запрос уже выполняется или завершён. Новая отправка не выполнялась.",
  invalid: "Проверьте финальный текст и подтверждение отправки.",
  unavailable: "Отправка недоступна. Внешний повтор не выполнялся.",
};

const RECONCILE_STATUS: Record<
  Exclude<PlatformWhatsAppReconcileActionState["status"], "idle">,
  string
> = {
  reconciled: "Проверка завершена; подтверждённое состояние сохранено.",
  already_completed: "Результат уже был подтверждён ранее.",
  still_unknown: "Совпадение не найдено. Повторная отправка остаётся заблокированной.",
  readback_failed: "Состояние WhatsApp не удалось проверить. Отправка остаётся заблокированной.",
  invalid: "Запрос проверки некорректен.",
  unavailable: "Проверка сейчас недоступна. Новая отправка не выполнялась.",
};

type RequestIds = Readonly<{
  gemini: string;
  review: string;
  send: string;
  reconcile: string;
}>;

type Props = Readonly<{
  conversationId: string;
  latestInboundSourceMessageId: string | null;
  proposal: PlatformStaffGeminiProposal | null;
  reviews: readonly PlatformGeminiProposalReview[];
  latestAttempt: PlatformManualWhatsAppSendAttempt | null;
  requestIds: RequestIds;
}>;

function reviewFields(
  conversationId: string,
  proposalRequestId: string,
  reviewRequestId: string,
  decision: "accepted" | "edited" | "rejected",
) {
  return (
    <>
      <input type="hidden" name="conversation_id" value={conversationId} />
      <input
        type="hidden"
        name="proposal_request_id"
        value={proposalRequestId}
      />
      <input
        type="hidden"
        name="review_request_id"
        value={reviewRequestId}
      />
      <input type="hidden" name="decision" value={decision} />
    </>
  );
}

function decisionLabel(
  decision: PlatformGeminiProposalReview["decision"],
): string {
  if (decision === "accepted") return "Принят без изменений";
  if (decision === "edited") return "Исправлен сотрудником";
  return "Отклонён";
}

function attemptLabel(
  status: PlatformManualWhatsAppSendAttempt["status"],
): string {
  if (status === "accepted") return "Принято WhatsApp";
  if (status === "unknown") return "Результат неизвестен";
  if (status === "rejected") return "Отклонено WhatsApp";
  return "Подготовлено к отправке";
}

const ACK_LABELS: Readonly<
  Record<NonNullable<PlatformManualWhatsAppSendAttempt["ackName"]>, string>
> = Object.freeze({
  ERROR: "Ошибка",
  PENDING: "Ожидает обработки",
  SERVER: "Принято сервером",
  DEVICE: "Доставлено на устройство",
  READ: "Прочитано",
  PLAYED: "Воспроизведено",
  UNKNOWN: "Состояние не определено",
});

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bishkek",
  }).format(timestamp);
}

export function InboxProviderWorkflowControls({
  conversationId,
  latestInboundSourceMessageId,
  proposal,
  reviews,
  latestAttempt,
  requestIds,
}: Props) {
  const router = useRouter();
  const latestReview = proposal
    ? reviews.find(
        (review) => review.proposalRequestId === proposal.proposalRequestId,
      ) ?? null
    : null;
  const [messageText, setMessageText] = useState(
    latestReview?.reviewedPayload?.reply_text ?? "",
  );
  const [confirmed, setConfirmed] = useState(false);
  const [geminiState, geminiAction, requesting] = useActionState(
    requestPlatformGeminiProposalAction,
    INITIAL_GEMINI_STATE,
  );
  const [reviewState, reviewAction, reviewing] = useActionState(
    reviewPlatformGeminiProposalAction,
    INITIAL_REVIEW_STATE,
  );
  const [sendState, sendAction, sending] = useActionState(
    sendPlatformWhatsAppMessageAction,
    INITIAL_SEND_STATE,
  );
  const [reconcileState, reconcileAction, reconciling] = useActionState(
    reconcilePlatformWhatsAppSendAction,
    INITIAL_RECONCILE_STATE,
  );

  const unresolvedAttempt =
    latestAttempt?.status === "prepared" || latestAttempt?.status === "unknown";
  const sendSettled =
    sendState.status === "succeeded" ||
    sendState.status === "unknown_result" ||
    sendState.status === "terminal_error" ||
    sendState.status === "not_claimed";

  useEffect(() => {
    if (
      geminiState.status === "proposal_ready" ||
      geminiState.status === "human_review" ||
      reviewState.status === "reviewed" ||
      sendState.status === "succeeded" ||
      sendState.status === "unknown_result" ||
      sendState.status === "terminal_error" ||
      sendState.status === "not_claimed" ||
      reconcileState.status === "reconciled" ||
      reconcileState.status === "already_completed"
    ) {
      const refreshTimer = window.setTimeout(() => {
        router.refresh();
      }, 600);
      return () => window.clearTimeout(refreshTimer);
    }
  }, [geminiState.status, reconcileState.status, reviewState.status, router, sendState.status]);

  return (
    <section
      className="space-y-5"
      data-testid="v3-inbox-provider-workflow-controls"
    >
      <div>
        <h3 className="text-md font-semibold text-fg">Ответ и отправка</h3>
        <p className="mt-1 max-w-[56ch] border-l-2 border-accent pl-3 text-sm leading-6 text-fg-2">
          ИИ только готовит черновик. Решение принимает сотрудник, а одно
          WhatsApp-сообщение отправляется лишь после отдельного подтверждения.
        </p>
      </div>

      {latestInboundSourceMessageId ? (
        <form action={geminiAction} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="conversation_id" value={conversationId} />
          <input
            type="hidden"
            name="source_message_id"
            value={latestInboundSourceMessageId}
          />
          <input type="hidden" name="request_id" value={requestIds.gemini} />
          <button
            type="submit"
            className={SECONDARY_BUTTON_CLASS}
            disabled={requesting}
            data-testid="v3-inbox-gemini-request"
          >
            {requesting ? "Gemini готовит черновик…" : "Подготовить черновик"}
          </button>
          {geminiState.status !== "idle" ? (
            <p
              role="status"
              className={
                geminiState.status === "proposal_ready"
                  ? "text-sm text-ok"
                  : "text-sm text-danger"
              }
            >
              {GEMINI_STATUS[geminiState.status]}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="rounded-ctl bg-warn-weak px-3 py-2 text-sm text-warn">
          Действия доступны только на странице с новыми сообщениями: источником
          должно быть последнее входящее сообщение.
        </p>
      )}

      <div className="space-y-3 rounded-ctl border border-border bg-surface-2 p-4">
        <h4 className="text-sm font-semibold text-fg">Черновик Gemini</h4>
        {proposal?.outcome === "proposal_ready" && proposal.proposal ? (
          <>
            <p className="whitespace-pre-wrap text-sm leading-6 text-fg">
              {proposal.proposal.reply_text}
            </p>
            <dl className="grid gap-3 text-xs text-fg-3 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-fg-2">Кратко</dt>
                <dd>{proposal.proposal.summary}</dd>
              </div>
              <div>
                <dt className="font-medium text-fg-2">Следующий шаг</dt>
                <dd>{proposal.proposal.next_action}</dd>
              </div>
            </dl>
          </>
        ) : proposal ? (
          <p className="text-sm text-warn">
            Gemini не подготовил безопасный черновик. Ответ составит сотрудник.
          </p>
        ) : (
          <p className="text-sm text-fg-3">Текущего черновика ещё нет.</p>
        )}
      </div>

      {proposal?.outcome === "proposal_ready" &&
      proposal.proposal &&
      latestReview === null ? (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-fg">
            Решение сотрудника
          </h4>
          <div className="flex flex-wrap gap-2">
            <form action={reviewAction}>
              {reviewFields(
                conversationId,
                proposal.proposalRequestId,
                requestIds.review,
                "accepted",
              )}
              <input type="hidden" name="edited_reply_text" value="" />
              <input type="hidden" name="reason" value="" />
              <button type="submit" className={BUTTON_CLASS} disabled={reviewing}>
                Принять без изменений
              </button>
            </form>
          </div>
          <form action={reviewAction} className="space-y-2">
            {reviewFields(
              conversationId,
              proposal.proposalRequestId,
              requestIds.review,
              "edited",
            )}
            <label className="block text-sm font-medium text-fg">
              Исправленный текст ответа
              <textarea
                name="edited_reply_text"
                required
                maxLength={3_000}
                rows={5}
                defaultValue={proposal.proposal.reply_text}
                className={FIELD_CLASS}
              />
            </label>
            <label className="block text-sm text-fg-2">
              Причина правки (необязательно)
              <input name="reason" maxLength={1_000} className={FIELD_CLASS} />
            </label>
            <button
              type="submit"
              className={SECONDARY_BUTTON_CLASS}
              disabled={reviewing}
            >
              Сохранить исправленный текст
            </button>
          </form>
          <form action={reviewAction} className="space-y-2">
            {reviewFields(
              conversationId,
              proposal.proposalRequestId,
              requestIds.review,
              "rejected",
            )}
            <input type="hidden" name="edited_reply_text" value="" />
            <label className="block text-sm text-fg-2">
              Почему черновик отклонён
              <input
                name="reason"
                required
                maxLength={1_000}
                className={FIELD_CLASS}
              />
            </label>
            <button
              type="submit"
              className={DANGER_BUTTON_CLASS}
              disabled={reviewing}
            >
              Отклонить черновик
            </button>
          </form>
        </div>
      ) : null}

      {reviewState.status !== "idle" ? (
        <p
          role="status"
          className={
            reviewState.status === "reviewed"
              ? "text-sm text-ok"
              : "text-sm text-danger"
          }
        >
          {REVIEW_STATUS[reviewState.status]}
        </p>
      ) : null}

      {reviews.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-fg">История решений</h4>
          <ol className="space-y-2 text-sm text-fg-2">
            {reviews.map((review) => (
              <li
                key={review.reviewId}
                className="rounded-ctl bg-surface-2 px-3 py-2"
              >
                <span className="font-medium text-fg">
                  {decisionLabel(review.decision)}
                </span>
                {review.reviewedPayload ? (
                  <span className="mt-1 block whitespace-pre-wrap">
                    {review.reviewedPayload.reply_text}
                  </span>
                ) : null}
                <span className="mt-1 block text-xs text-fg-3">
                  {review.reviewedByName} · {formatTimestamp(review.reviewedAt)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="space-y-3 border-t border-border pt-5">
        <h4 className="text-sm font-semibold text-fg">
          Одно подтверждённое сообщение WhatsApp
        </h4>
        <form action={sendAction} className="space-y-3">
          <input type="hidden" name="conversation_id" value={conversationId} />
          <input
            type="hidden"
            name="source_message_id"
            value={latestInboundSourceMessageId ?? ""}
          />
          <input type="hidden" name="send_request_id" value={requestIds.send} />
          <label className="block text-sm font-medium text-fg">
            Финальный текст сотрудника
            <textarea
              name="message_text"
              required
              maxLength={3_000}
              rows={5}
              value={messageText}
              onChange={(event) => {
                setMessageText(event.currentTarget.value);
                setConfirmed(false);
              }}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-ctl px-2 py-2 text-sm leading-5 text-fg-2 hover:bg-surface-2">
            <input
              type="checkbox"
              name="confirm_send"
              value="1"
              required
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <span>
              Я проверил(а) получателя и финальный текст и подтверждаю одну
              отправку в этот диалог.
            </span>
          </label>
          <button
            type="submit"
            className={BUTTON_CLASS}
            disabled={
              sending ||
              sendSettled ||
              latestInboundSourceMessageId === null ||
              unresolvedAttempt ||
              !confirmed ||
              messageText.trim().length === 0
            }
            data-testid="v3-inbox-send"
          >
            {sending ? "Отправка…" : "Отправить одно сообщение"}
          </button>
        </form>

        {sendState.status !== "idle" ? (
          <p
            role="status"
            className={
              sendState.status === "succeeded"
                ? "text-sm text-ok"
                : "text-sm text-danger"
            }
          >
            {SEND_STATUS[sendState.status]}
          </p>
        ) : null}

        {latestAttempt ? (
          <div
            className="space-y-2 rounded-ctl border border-border bg-surface-2 px-3 py-3 text-sm text-fg-2"
            data-testid="v3-inbox-latest-attempt"
          >
            <p className="font-semibold text-fg">Последняя попытка</p>
            <p>{attemptLabel(latestAttempt.status)}</p>
            {latestAttempt.ackName ? (
              <p className="text-xs text-fg-3">
                Подтверждение WhatsApp: {ACK_LABELS[latestAttempt.ackName]}
              </p>
            ) : null}
            {latestAttempt.reconciliationRequired ? (
              <form action={reconcileAction}>
                <input
                  type="hidden"
                  name="conversation_id"
                  value={conversationId}
                />
                <input
                  type="hidden"
                  name="attempt_id"
                  value={latestAttempt.attemptId}
                />
                <input
                  type="hidden"
                  name="reconcile_request_id"
                  value={requestIds.reconcile}
                />
                <button
                  type="submit"
                  className={SECONDARY_BUTTON_CLASS}
                  disabled={reconciling}
                  data-testid="v3-inbox-reconcile"
                >
                  {reconciling
                    ? "Проверка…"
                    : "Проверить результат без новой отправки"}
                </button>
              </form>
            ) : null}
            {reconcileState.status !== "idle" ? (
              <p
                role="status"
                className={
                  reconcileState.status === "reconciled" ||
                  reconcileState.status === "already_completed"
                    ? "text-sm text-ok"
                    : "text-sm text-danger"
                }
              >
                {RECONCILE_STATUS[reconcileState.status]}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
