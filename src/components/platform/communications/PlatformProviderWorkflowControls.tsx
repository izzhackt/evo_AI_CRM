"use client";

import { useActionState, useState } from "react";

import { btnCls, btnDangerGhostCls, btnGhostCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type {
  PlatformGeminiRequestActionState,
  PlatformGeminiReviewActionState,
  PlatformWhatsAppReconcileActionState,
  PlatformWhatsAppSendActionState,
} from "@/lib/platform-provider-actions";
import type {
  PlatformGeminiProposalReview,
  PlatformManualWhatsAppSendAttempt,
  PlatformStaffGeminiProposal,
} from "@/lib/platform-provider-workflows";

const COPY = {
  ru: {
    title: "Ответ и отправка",
    advisory:
      "ИИ только готовит черновик. Решение принимает сотрудник, а WhatsApp-сообщение отправляется лишь после отдельного подтверждения.",
    request: "Подготовить черновик",
    requesting: "Gemini готовит черновик…",
    newestRequired:
      "Действия доступны только на странице с новыми сообщениями: источник должен быть последним входящим сообщением.",
    noProposal: "Текущего Gemini-черновика ещё нет.",
    draftTitle: "Черновик Gemini",
    summary: "Кратко",
    nextAction: "Следующий шаг",
    modelFailure: "Gemini не подготовил безопасный черновик. Ответ составит сотрудник.",
    reviewTitle: "Проверка сотрудником",
    accept: "Принять без изменений",
    edit: "Сохранить исправленный текст",
    reject: "Отклонить черновик",
    editLabel: "Исправьте только текст ответа",
    editReason: "Причина правки (необязательно)",
    rejectReason: "Почему черновик отклонён",
    reviewed: "Решение сохранено",
    reviewHistory: "История проверки",
    by: "Сотрудник",
    sendTitle: "Одно подтверждённое сообщение WhatsApp",
    sendText: "Финальный текст сотрудника",
    confirm:
      "Я проверил(а) финальный текст и подтверждаю одну отправку в этот диалог.",
    send: "Отправить одно сообщение",
    sending: "Отправка…",
    sent: "WhatsApp принял сообщение; результат сохранён.",
    unknown:
      "Результат неизвестен. Повторная отправка заблокирована до сверки с WAHA.",
    rejected: "Провайдер отклонил отправку; повтор автоматически не выполняется.",
    notClaimed: "Запрос уже обрабатывается или завершён. Новая отправка не выполнялась.",
    unavailable: "Действие сейчас недоступно. Внешний повтор не выполнялся.",
    invalid: "Проверьте обязательные поля.",
    attemptTitle: "Последняя попытка",
    attemptStatus: "Статус",
    ack: "Подтверждение WAHA",
    reconcile: "Сверить с WAHA без отправки",
    reconciling: "Сверка…",
    reconciled: "Сверка завершена; сохранено подтверждённое состояние.",
    stillUnknown: "Совпадение не найдено. Отправка остаётся заблокированной.",
    requestReady: "Черновик сохранён и ждёт решения сотрудника.",
    requestReview: "Gemini не дал безопасный результат; нужен ответ сотрудника.",
    requestProgress: "Этот запрос уже выполняется.",
    configuration: "Gemini не настроен на сервере.",
  },
  ky: {
    title: "Жооп жана жөнөтүү",
    advisory:
      "AI болгону долбоор даярдайт. Чечимди кызматкер кабыл алат, WhatsApp билдирүүсү өзүнчө ырастоодон кийин гана жөнөтүлөт.",
    request: "Долбоор даярдоо",
    requesting: "Gemini долбоор даярдап жатат…",
    newestRequired:
      "Аракеттер жаңы билдирүүлөр барагында гана жеткиликтүү: булак акыркы кирген билдирүү болушу керек.",
    noProposal: "Учурда Gemini долбоору жок.",
    draftTitle: "Gemini долбоору",
    summary: "Кыскача",
    nextAction: "Кийинки кадам",
    modelFailure: "Gemini коопсуз долбоор даярдаган жок. Жоопту кызматкер түзөт.",
    reviewTitle: "Кызматкердин текшерүүсү",
    accept: "Өзгөртүүсүз кабыл алуу",
    edit: "Оңдолгон текстти сактоо",
    reject: "Долбоорду четке кагуу",
    editLabel: "Жооптун текстин гана оңдоңуз",
    editReason: "Оңдоонун себеби (милдеттүү эмес)",
    rejectReason: "Долбоор эмне үчүн четке кагылды",
    reviewed: "Чечим сакталды",
    reviewHistory: "Текшерүү тарыхы",
    by: "Кызматкер",
    sendTitle: "Бир ырасталган WhatsApp билдирүүсү",
    sendText: "Кызматкердин акыркы тексти",
    confirm: "Акыркы текстти текшердим жана бул диалогго бир жолу жөнөтүүнү ырастайм.",
    send: "Бир билдирүү жөнөтүү",
    sending: "Жөнөтүлүүдө…",
    sent: "WhatsApp билдирүүнү кабыл алды; жыйынтык сакталды.",
    unknown: "Жыйынтык белгисиз. WAHA менен сверкага чейин кайра жөнөтүү бөгөттөлдү.",
    rejected: "Провайдер жөнөтүүнү четке какты; кайталоо жүргүзүлгөн жок.",
    notClaimed: "Сурам иштетилип жатат же аяктаган. Жаңы жөнөтүү болгон жок.",
    unavailable: "Аракет азыр жеткиликсиз. Сырткы кайталоо болгон жок.",
    invalid: "Милдеттүү талааларды текшериңиз.",
    attemptTitle: "Акыркы аракет",
    attemptStatus: "Статус",
    ack: "WAHA ырастоосу",
    reconcile: "Жөнөтпөстөн WAHA менен сверка кылуу",
    reconciling: "Сверка…",
    reconciled: "Сверка бүттү; ырасталган абал сакталды.",
    stillUnknown: "Дал келүү табылган жок. Жөнөтүү бөгөттөлгөн бойдон калды.",
    requestReady: "Долбоор сакталды жана кызматкердин чечимин күтөт.",
    requestReview: "Gemini коопсуз жыйынтык берген жок; кызматкердин жообу керек.",
    requestProgress: "Бул сурам аткарылып жатат.",
    configuration: "Gemini серверде жөндөлгөн эмес.",
  },
  en: {
    title: "Reply and send",
    advisory:
      "AI is advisory only: it prepares a draft. Staff make the decision, and WhatsApp sends only after a separate confirmation.",
    request: "Prepare a draft",
    requesting: "Gemini is preparing a draft…",
    newestRequired:
      "Actions are available only on the newest message page because the source must be the latest inbound message.",
    noProposal: "There is no current Gemini draft yet.",
    draftTitle: "Gemini draft",
    summary: "Summary",
    nextAction: "Next action",
    modelFailure: "Gemini did not produce a safe draft. Staff must write the reply.",
    reviewTitle: "Staff review",
    accept: "Accept unchanged",
    edit: "Save edited text",
    reject: "Reject draft",
    editLabel: "Edit only the reply text",
    editReason: "Reason for edit (optional)",
    rejectReason: "Why the draft is rejected",
    reviewed: "The decision was stored",
    reviewHistory: "Review history",
    by: "Staff member",
    sendTitle: "One confirmed WhatsApp message",
    sendText: "Final staff text",
    confirm: "I reviewed the final text and confirm one send to this conversation.",
    send: "Send one message",
    sending: "Sending…",
    sent: "WhatsApp accepted the message and the result was stored.",
    unknown: "The result is unknown. Resend is blocked until WAHA reconciliation.",
    rejected: "The provider rejected the send; no retry was made.",
    notClaimed: "The request is already processing or complete. No new send was made.",
    unavailable: "This action is unavailable. No external retry was made.",
    invalid: "Check the required fields.",
    attemptTitle: "Latest attempt",
    attemptStatus: "Status",
    ack: "WAHA acknowledgement",
    reconcile: "Reconcile with WAHA without sending",
    reconciling: "Reconciling…",
    reconciled: "Reconciliation finished and the confirmed state was stored.",
    stillUnknown: "No match was found. Sending remains blocked.",
    requestReady: "The draft is stored and awaits a staff decision.",
    requestReview: "Gemini returned no safe draft; a staff reply is required.",
    requestProgress: "This request is already in progress.",
    configuration: "Gemini is not configured on the server.",
  },
} as const;

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

type RequestIds = Readonly<{
  gemini: string;
  review: string;
  send: string;
  reconcile: string;
}>;

type Props = Readonly<{
  locale: Locale;
  conversationId: string;
  latestInboundSourceMessageId: string | null;
  proposal: PlatformStaffGeminiProposal | null;
  reviews: readonly PlatformGeminiProposalReview[];
  latestAttempt: PlatformManualWhatsAppSendAttempt | null;
  requestIds: RequestIds;
  requestGemini: (
    previous: PlatformGeminiRequestActionState,
    form: FormData,
  ) => Promise<PlatformGeminiRequestActionState>;
  reviewGemini: (
    previous: PlatformGeminiReviewActionState,
    form: FormData,
  ) => Promise<PlatformGeminiReviewActionState>;
  sendWhatsApp: (
    previous: PlatformWhatsAppSendActionState,
    form: FormData,
  ) => Promise<PlatformWhatsAppSendActionState>;
  reconcileWhatsApp: (
    previous: PlatformWhatsAppReconcileActionState,
    form: FormData,
  ) => Promise<PlatformWhatsAppReconcileActionState>;
}>;

function reviewHiddenFields(
  conversationId: string,
  proposalRequestId: string,
  reviewRequestId: string,
  decision: "accepted" | "edited" | "rejected",
) {
  return (
    <>
      <input type="hidden" name="conversation_id" value={conversationId} />
      <input type="hidden" name="proposal_request_id" value={proposalRequestId} />
      <input type="hidden" name="review_request_id" value={reviewRequestId} />
      <input type="hidden" name="decision" value={decision} />
    </>
  );
}

function formatTimestamp(value: string, locale: Locale): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return "—";
  return new Intl.DateTimeFormat(
    locale === "ky" ? "ky-KG" : locale === "en" ? "en-GB" : "ru-RU",
    { dateStyle: "medium", timeStyle: "short" },
  ).format(timestamp);
}

export function PlatformProviderWorkflowControls({
  locale,
  conversationId,
  latestInboundSourceMessageId,
  proposal,
  reviews,
  latestAttempt,
  requestIds,
  requestGemini,
  reviewGemini,
  sendWhatsApp,
  reconcileWhatsApp,
}: Props) {
  const copy = COPY[locale];
  const latestReview = proposal
    ? reviews.find((review) => review.proposalRequestId === proposal.proposalRequestId) ?? null
    : null;
  const reviewedReply = latestReview?.reviewedPayload?.reply_text ?? "";
  const [messageText, setMessageText] = useState(reviewedReply);
  const [confirmed, setConfirmed] = useState(false);
  const [geminiState, geminiAction, requesting] = useActionState(
    requestGemini,
    INITIAL_GEMINI_STATE,
  );
  const [reviewState, reviewAction, reviewing] = useActionState(
    reviewGemini,
    INITIAL_REVIEW_STATE,
  );
  const [sendState, sendAction, sending] = useActionState(
    sendWhatsApp,
    INITIAL_SEND_STATE,
  );
  const [reconcileState, reconcileAction, reconciling] = useActionState(
    reconcileWhatsApp,
    INITIAL_RECONCILE_STATE,
  );
  const unresolvedAttempt = latestAttempt?.status === "prepared" ||
    latestAttempt?.status === "unknown";
  const sendActionSettled = sendState.status === "succeeded" ||
    sendState.status === "unknown_result" ||
    sendState.status === "terminal_error" ||
    sendState.status === "not_claimed";

  return (
    <section
      className="space-y-5 border-t border-border pt-4"
      data-testid="platform-provider-workflow-controls"
    >
      <div>
        <h3 className="text-md font-semibold text-fg">{copy.title}</h3>
        <p className="mt-1 max-w-[64ch] border-l-2 border-accent pl-3 text-sm leading-6 text-fg-2">
          {copy.advisory}
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
          <button type="submit" className={btnGhostCls} disabled={requesting}>
            {requesting ? copy.requesting : copy.request}
          </button>
          {geminiState.status !== "idle" ? (
            <p className="text-sm text-fg-3" role="status">
              {geminiState.status === "proposal_ready"
                ? copy.requestReady
                : geminiState.status === "human_review"
                  ? copy.requestReview
                  : geminiState.status === "in_progress"
                    ? copy.requestProgress
                    : geminiState.status === "blocked"
                      ? copy.configuration
                      : geminiState.status === "invalid"
                        ? copy.invalid
                        : copy.unavailable}
            </p>
          ) : null}
        </form>
      ) : (
        <p className="rounded-ctl bg-warn-weak px-3 py-2 text-sm text-warn">
          {copy.newestRequired}
        </p>
      )}

      <div className="space-y-3 rounded-ctl border border-border bg-surface-2 p-4">
        <h4 className="text-sm font-semibold text-fg">{copy.draftTitle}</h4>
        {proposal?.outcome === "proposal_ready" && proposal.proposal ? (
          <>
            <p className="whitespace-pre-wrap text-sm leading-6 text-fg">
              {proposal.proposal.reply_text}
            </p>
            <dl className="grid gap-2 text-xs text-fg-3 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-fg-2">{copy.summary}</dt>
                <dd>{proposal.proposal.summary}</dd>
              </div>
              <div>
                <dt className="font-medium text-fg-2">{copy.nextAction}</dt>
                <dd>{proposal.proposal.next_action}</dd>
              </div>
            </dl>
          </>
        ) : proposal ? (
          <p className="text-sm text-warn">{copy.modelFailure}</p>
        ) : (
          <p className="text-sm text-fg-3">{copy.noProposal}</p>
        )}
      </div>

      {proposal?.outcome === "proposal_ready" &&
      proposal.proposal &&
      latestReview === null ? (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-fg">{copy.reviewTitle}</h4>
          <form action={reviewAction}>
            {reviewHiddenFields(
              conversationId,
              proposal.proposalRequestId,
              requestIds.review,
              "accepted",
            )}
            <input type="hidden" name="edited_reply_text" value="" />
            <input type="hidden" name="reason" value="" />
            <button type="submit" className={btnCls} disabled={reviewing}>
              {copy.accept}
            </button>
          </form>
          <form action={reviewAction} className="space-y-2">
            {reviewHiddenFields(
              conversationId,
              proposal.proposalRequestId,
              requestIds.review,
              "edited",
            )}
            <label className="block text-sm font-medium text-fg">
              {copy.editLabel}
              <textarea
                name="edited_reply_text"
                required
                maxLength={3_000}
                rows={5}
                defaultValue={proposal.proposal.reply_text}
                className="mt-1 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-base leading-6 text-fg"
              />
            </label>
            <label className="block text-sm text-fg-2">
              {copy.editReason}
              <input
                name="reason"
                maxLength={1_000}
                className="mt-1 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-base text-fg"
              />
            </label>
            <button type="submit" className={btnGhostCls} disabled={reviewing}>
              {copy.edit}
            </button>
          </form>
          <form action={reviewAction} className="space-y-2">
            {reviewHiddenFields(
              conversationId,
              proposal.proposalRequestId,
              requestIds.review,
              "rejected",
            )}
            <input type="hidden" name="edited_reply_text" value="" />
            <label className="block text-sm text-fg-2">
              {copy.rejectReason}
              <input
                name="reason"
                required
                maxLength={1_000}
                className="mt-1 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-base text-fg"
              />
            </label>
            <button
              type="submit"
              className={btnDangerGhostCls}
              disabled={reviewing}
            >
              {copy.reject}
            </button>
          </form>
        </div>
      ) : null}

      {reviewState.status !== "idle" ? (
        <p
          role="status"
          className={cn(
            "text-sm",
            reviewState.status === "reviewed" ? "text-ok" : "text-danger",
          )}
        >
          {reviewState.status === "reviewed"
            ? copy.reviewed
            : reviewState.status === "invalid"
              ? copy.invalid
              : copy.unavailable}
        </p>
      ) : null}

      {reviews.length > 0 ? (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-fg">{copy.reviewHistory}</h4>
          <ul className="space-y-2 text-sm text-fg-2">
            {reviews.map((review) => (
              <li key={review.reviewId} className="rounded-ctl bg-surface-2 px-3 py-2">
                <span className="font-medium text-fg">{review.decision}</span>
                {review.reviewedPayload ? (
                  <span className="mt-1 block whitespace-pre-wrap">
                    {review.reviewedPayload.reply_text}
                  </span>
                ) : null}
                <span className="mt-1 block text-xs text-fg-3">
                  {copy.by}: {review.reviewedByName} · {formatTimestamp(review.reviewedAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-3 border-t border-border pt-4">
        <h4 className="text-sm font-semibold text-fg">{copy.sendTitle}</h4>
        <form action={sendAction} className="space-y-3">
          <input type="hidden" name="conversation_id" value={conversationId} />
          <input
            type="hidden"
            name="source_message_id"
            value={latestInboundSourceMessageId ?? ""}
          />
          <input type="hidden" name="send_request_id" value={requestIds.send} />
          <label className="block text-sm font-medium text-fg">
            {copy.sendText}
            <textarea
              name="message_text"
              required
              maxLength={3_000}
              rows={5}
              value={messageText}
              onChange={(event) => {
                setMessageText(event.target.value);
                setConfirmed(false);
              }}
              className="mt-1 w-full rounded-ctl border border-control-edge bg-surface px-3 py-2 text-base leading-6 text-fg"
            />
          </label>
          <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-ctl px-2 py-2 text-sm leading-5 text-fg-2 hover:bg-surface-2">
            <input
              type="checkbox"
              name="confirm_send"
              value="1"
              required
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <span>{copy.confirm}</span>
          </label>
          <button
            type="submit"
            className={btnCls}
            disabled={
              sending ||
              sendActionSettled ||
              !latestInboundSourceMessageId ||
              unresolvedAttempt ||
              !confirmed ||
              messageText.trim().length === 0
            }
            data-testid="platform-provider-send"
          >
            {sending ? copy.sending : copy.send}
          </button>
        </form>

        {sendState.status !== "idle" ? (
          <p
            role="status"
            className={cn(
              "text-sm",
              sendState.status === "succeeded" ? "text-ok" : "text-danger",
            )}
          >
            {sendState.status === "succeeded"
              ? copy.sent
              : sendState.status === "unknown_result"
                ? copy.unknown
                : sendState.status === "terminal_error"
                  ? copy.rejected
                  : sendState.status === "not_claimed"
                    ? copy.notClaimed
                    : sendState.status === "invalid"
                      ? copy.invalid
                      : copy.unavailable}
          </p>
        ) : null}
      </div>

      {latestAttempt ? (
        <div className="space-y-2 rounded-ctl border border-border bg-surface-2 p-4">
          <h4 className="text-sm font-semibold text-fg">{copy.attemptTitle}</h4>
          <p className="text-sm text-fg-2">
            {copy.attemptStatus}: {latestAttempt.status}
          </p>
          {latestAttempt.ackName ? (
            <p className="text-sm text-fg-2">
              {copy.ack}: {latestAttempt.ackName}
            </p>
          ) : null}
          {latestAttempt.status === "unknown" ? (
            <p className="text-sm font-medium text-warn">{copy.unknown}</p>
          ) : null}
          {latestAttempt.reconciliationRequired ? (
            <form action={reconcileAction}>
              <input type="hidden" name="conversation_id" value={conversationId} />
              <input type="hidden" name="attempt_id" value={latestAttempt.attemptId} />
              <input
                type="hidden"
                name="reconcile_request_id"
                value={requestIds.reconcile}
              />
              <button
                type="submit"
                className={btnGhostCls}
                disabled={reconciling}
                data-testid="platform-provider-reconcile"
              >
                {reconciling ? copy.reconciling : copy.reconcile}
              </button>
            </form>
          ) : null}
          {reconcileState.status !== "idle" ? (
            <p
              role="status"
              className={cn(
                "text-sm",
                reconcileState.status === "reconciled" ||
                    reconcileState.status === "already_completed"
                  ? "text-ok"
                  : "text-danger",
              )}
            >
              {reconcileState.status === "reconciled" ||
              reconcileState.status === "already_completed"
                ? copy.reconciled
                : reconcileState.status === "still_unknown"
                  ? copy.stillUnknown
                  : reconcileState.status === "invalid"
                    ? copy.invalid
                    : copy.unavailable}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
