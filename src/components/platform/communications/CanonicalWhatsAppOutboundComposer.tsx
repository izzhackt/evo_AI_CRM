"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { btnCls, btnGhostCls, cn } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import {
  reconcileCanonicalWhatsAppOutboundAction,
  sendCanonicalWhatsAppOutboundAction,
  type CanonicalWhatsAppReconcileActionState,
  type CanonicalWhatsAppSendActionState,
} from "@/lib/server/canonical-whatsapp-outbound-actions";
import type { CanonicalWhatsAppSendAttemptSnapshot } from "@/lib/server/canonical-crm-repository";
import type { CanonicalWahaProviderAvailability } from "@/lib/server/canonical-waha-provider";

const DIRECT_RECIPIENT_PATTERN = /^[1-9][0-9]{4,31}@(c[.]us|lid)$/;

const COPY = {
  ru: {
    title: "Финальная отправка в WhatsApp",
    description:
      "Проверьте точного получателя и окончательный текст. Отправка начнётся только после явного подтверждения сотрудника.",
    recipient: "Точный WhatsApp ID",
    text: "Окончательный текст",
    confirm: "Я проверил(а) получателя и текст и подтверждаю одну отправку.",
    send: "Отправить один раз",
    sending: "Фиксируем попытку и отправляем…",
    configured: "WAHA настроен server-only",
    blocked: "Отправка заблокирована настройками",
    invalidRecipient: "У диалога нет допустимого прямого @c.us/@lid получателя.",
    unresolved:
      "Новая отправка заблокирована: предыдущая попытка осталась неопределённой и требует проверки.",
    accepted: "WAHA подтвердил отправку. Сообщение сохранено в EVO.",
    unknown:
      "Результат неизвестен. EVO не создал сообщение и не будет повторять отправку автоматически.",
    rejected: "Отправка не состоялась. WAHA или проверка до отправки отклонили запрос.",
    error: "Команда не выполнена. Проверьте состояние диалога и настройки.",
    lastAttempt: "Последняя попытка",
    status: "Статус",
    ack: "Доставка",
    reconcile: "Обновить доставку из WAHA",
    recover: "Найти уже отправленное в WAHA",
    reconciling: "Проверяем точное сообщение…",
    reconciled: "Статус доставки обновлён без повторной отправки.",
    noAttempt: "Отправок из V2 по этому диалогу ещё нет.",
  },
  ky: {
    title: "WhatsApp'ка акыркы жөнөтүү",
    description:
      "Так алуучуну жана акыркы текстти текшериңиз. Кызматкер ачык ырастагандан кийин гана бир жөнөтүү башталат.",
    recipient: "Так WhatsApp ID",
    text: "Акыркы текст",
    confirm: "Алуучуну жана текстти текшердим, бир жөнөтүүнү ырастайм.",
    send: "Бир жолу жөнөтүү",
    sending: "Аракетти сактап, жөнөтүп жатабыз…",
    configured: "WAHA server-only жөндөлгөн",
    blocked: "Жөнөтүү жөндөөлөр менен бөгөттөлгөн",
    invalidRecipient: "Диалогдо жарактуу түз @c.us/@lid алуучу жок.",
    unresolved:
      "Жаңы жөнөтүү бөгөттөлдү: мурунку аракеттин жыйынтыгы белгисиз жана текшерүүнү талап кылат.",
    accepted: "WAHA жөнөтүүнү ырастады. Билдирүү EVO'до сакталды.",
    unknown:
      "Натыйжа белгисиз. EVO билдирүү түзгөн жок жана автоматтык кайра жөнөтпөйт.",
    rejected: "Жөнөтүү болгон жок. WAHA же алдын ала текшерүү сурамды четке какты.",
    error: "Команда аткарылган жок. Диалогду жана жөндөөлөрдү текшериңиз.",
    lastAttempt: "Акыркы аракет",
    status: "Статус",
    ack: "Жеткирүү",
    reconcile: "WAHA'дан жеткирүүнү жаңыртуу",
    recover: "WAHA'дан жөнөтүлгөн билдирүүнү табуу",
    reconciling: "Так билдирүүнү текшерип жатабыз…",
    reconciled: "Жеткирүү абалы кайра жөнөтүүсүз жаңырды.",
    noAttempt: "Бул диалог үчүн V2 жөнөтүүсү азырынча жок.",
  },
  en: {
    title: "Final WhatsApp send",
    description:
      "Verify the exact recipient and final text. One send starts only after explicit staff confirmation.",
    recipient: "Exact WhatsApp ID",
    text: "Final text",
    confirm: "I verified the recipient and text and confirm one send.",
    send: "Send once",
    sending: "Persisting the attempt and sending…",
    configured: "WAHA is configured server-only",
    blocked: "Sending is blocked by configuration",
    invalidRecipient: "This conversation has no valid direct @c.us/@lid recipient.",
    unresolved:
      "A new send is blocked because the prior attempt is unresolved and requires investigation.",
    accepted: "WAHA confirmed the send. The message is stored in EVO.",
    unknown:
      "The outcome is unknown. EVO created no message and will not resend automatically.",
    rejected: "The send did not occur. WAHA or the pre-send check rejected it.",
    error: "The command did not complete. Check the conversation and configuration.",
    lastAttempt: "Latest attempt",
    status: "Status",
    ack: "Delivery",
    reconcile: "Refresh delivery from WAHA",
    recover: "Find the already-sent WAHA message",
    reconciling: "Reading the exact message…",
    reconciled: "Delivery was refreshed without sending again.",
    noAttempt: "V2 has not sent from this conversation yet.",
  },
} as const;

const INITIAL_SEND_STATE: CanonicalWhatsAppSendActionState = Object.freeze({
  status: "idle",
  reason: null,
  attemptId: null,
  messageId: null,
  ackName: null,
});

const INITIAL_RECONCILE_STATE: CanonicalWhatsAppReconcileActionState =
  Object.freeze({
    status: "idle",
    reason: null,
    attemptId: null,
    ackName: null,
  });

function actionMessage(
  locale: Locale,
  status: CanonicalWhatsAppSendActionState["status"],
) {
  const copy = COPY[locale];
  if (status === "accepted") return copy.accepted;
  if (status === "unknown") return copy.unknown;
  if (status === "rejected") return copy.rejected;
  return copy.error;
}

export function CanonicalWhatsAppOutboundComposer({
  locale,
  conversationId,
  recipientChatId,
  availability,
  latestAttempt,
  sendRequestId,
  reconcileRequestId,
  suggestedText,
  sourceProposalId,
}: Readonly<{
  locale: Locale;
  conversationId: string;
  recipientChatId: string | null;
  availability: CanonicalWahaProviderAvailability;
  latestAttempt: CanonicalWhatsAppSendAttemptSnapshot | null;
  sendRequestId: string;
  reconcileRequestId: string;
  suggestedText: string;
  sourceProposalId: string | null;
}>) {
  const copy = COPY[locale];
  const router = useRouter();
  const [messageText, setMessageText] = useState(suggestedText);
  const [confirmed, setConfirmed] = useState(false);
  const [sendState, sendAction, sending] = useActionState(
    sendCanonicalWhatsAppOutboundAction,
    INITIAL_SEND_STATE,
  );
  const [reconcileState, reconcileAction, reconciling] = useActionState(
    reconcileCanonicalWhatsAppOutboundAction,
    INITIAL_RECONCILE_STATE,
  );
  const directRecipient =
    recipientChatId !== null && DIRECT_RECIPIENT_PATTERN.test(recipientChatId);
  const configured = availability.status === "configured";
  const unresolvedAttempt =
    latestAttempt?.status === "prepared" || latestAttempt?.status === "unknown";
  const canReconcileAttempt =
    latestAttempt?.status === "unknown" ||
    (latestAttempt?.status === "accepted" &&
      latestAttempt.providerMessageId !== null);

  useEffect(() => {
    if (
      sendState.status === "accepted" ||
      sendState.status === "unknown" ||
      sendState.status === "rejected" ||
      reconcileState.status === "reconciled"
    ) {
      router.refresh();
    }
  }, [sendState.status, reconcileState.status, router]);

  return (
    <section
      className="space-y-4 rounded-card border border-border bg-surface-2 p-4"
      data-testid="canonical-whatsapp-outbound-composer"
    >
      <div>
        <h3 className="text-[15px] font-semibold text-fg">{copy.title}</h3>
        <p className="mt-1 text-[13px] leading-6 text-fg-3">{copy.description}</p>
      </div>

      <div
        className={cn(
          "rounded-ctl border px-3 py-2 text-[13px]",
          configured
            ? "border-ok/30 bg-ok-weak text-ok"
            : "border-warn/30 bg-warn-weak text-warn",
        )}
        data-testid="canonical-whatsapp-provider-availability"
        data-status={availability.status}
        data-reason={availability.status === "blocked" ? availability.reason : undefined}
      >
        {configured ? copy.configured : copy.blocked}
      </div>

      <form action={sendAction} className="space-y-3">
        <input type="hidden" name="conversation_id" value={conversationId} />
        <input type="hidden" name="send_request_id" value={sendRequestId} />
        <input
          type="hidden"
          name="confirmed_recipient"
          value={recipientChatId ?? ""}
        />
        <input
          type="hidden"
          name="source_proposal_id"
          value={messageText === suggestedText ? sourceProposalId ?? "" : ""}
        />
        <input type="hidden" name="reply_to_external_message_id" value="" />

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-fg-3">
            {copy.recipient}
          </p>
          <code
            className="mt-1 block break-all rounded-ctl border border-border bg-surface px-3 py-2 text-[13px] text-fg"
            data-testid="canonical-whatsapp-outbound-recipient"
          >
            {recipientChatId ?? "—"}
          </code>
          {!directRecipient ? (
            <p className="mt-1 text-[12px] text-danger">{copy.invalidRecipient}</p>
          ) : null}
        </div>

        <label className="block text-[13px] font-medium text-fg" htmlFor="canonical-whatsapp-final-text">
          {copy.text}
        </label>
        <textarea
          id="canonical-whatsapp-final-text"
          name="message_text"
          required
          maxLength={3_000}
          rows={5}
          value={messageText}
          onChange={(event) => {
            setMessageText(event.target.value);
            setConfirmed(false);
          }}
          className="w-full rounded-ctl border border-border bg-surface px-3 py-2 text-[13.5px] leading-6 text-fg"
          data-testid="canonical-whatsapp-outbound-text"
        />

        <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-ctl px-2 py-2 text-[13px] leading-5 text-fg-2 hover:bg-surface-2">
          <input
            type="checkbox"
            name="confirm_send"
            value="1"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0"
            data-testid="canonical-whatsapp-outbound-confirm"
          />
          <span>{copy.confirm}</span>
        </label>

        <button
          type="submit"
          className={btnCls}
          disabled={
            sending ||
            !configured ||
            !directRecipient ||
            unresolvedAttempt ||
            !confirmed ||
            messageText.trim().length === 0
          }
          data-testid="canonical-whatsapp-outbound-send"
        >
          {sending ? copy.sending : copy.send}
        </button>
        {unresolvedAttempt ? (
          <p
            className="text-[12px] leading-5 text-danger"
            data-testid="canonical-whatsapp-outbound-unresolved"
          >
            {copy.unresolved}
          </p>
        ) : null}
      </form>

      {sendState.status !== "idle" ? (
        <p
          role="status"
          className={cn(
            "text-[13px] leading-6",
            sendState.status === "accepted" ? "text-ok" : "text-danger",
          )}
          data-testid="canonical-whatsapp-outbound-state"
          data-status={sendState.status}
          data-reason={sendState.reason ?? undefined}
        >
          {actionMessage(locale, sendState.status)}
        </p>
      ) : null}

      <div className="space-y-2 border-t border-border pt-3" data-testid="canonical-whatsapp-latest-attempt">
        <h4 className="text-[13px] font-semibold text-fg">{copy.lastAttempt}</h4>
        {latestAttempt ? (
          <>
            <p className="text-[12px] text-fg-3">
              {copy.status}: <strong>{latestAttempt.status}</strong>
              {latestAttempt.ackName ? ` · ${copy.ack}: ${latestAttempt.ackName}` : ""}
            </p>
            {canReconcileAttempt ? (
              <form action={reconcileAction}>
                <input type="hidden" name="conversation_id" value={conversationId} />
                <input type="hidden" name="attempt_id" value={latestAttempt.attemptId} />
                <input
                  type="hidden"
                  name="reconcile_request_id"
                  value={reconcileRequestId}
                />
                <button
                  type="submit"
                  className={btnGhostCls}
                  disabled={!configured || reconciling}
                  data-testid="canonical-whatsapp-outbound-reconcile"
                >
                  {reconciling
                    ? copy.reconciling
                    : latestAttempt.status === "unknown"
                      ? copy.recover
                      : copy.reconcile}
                </button>
              </form>
            ) : null}
          </>
        ) : (
          <p className="text-[12px] text-fg-3">{copy.noAttempt}</p>
        )}
        {reconcileState.status !== "idle" ? (
          <p
            role="status"
            className={cn(
              "text-[12px]",
              reconcileState.status === "reconciled"
                ? "text-ok"
                : "text-danger",
            )}
            data-testid="canonical-whatsapp-reconcile-state"
            data-status={reconcileState.status}
            data-reason={reconcileState.reason ?? undefined}
          >
            {reconcileState.status === "reconciled" ? copy.reconciled : copy.error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
