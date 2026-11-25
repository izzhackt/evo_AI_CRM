// «Отправить на проверку» у одного требования и «Проверить результат» после неоконченной отправки. Веб: `ProgramDocumentSubmit`
// в `ProgramDocumentControls.tsx`. Студенту кнопка скрыта, пока нет ни сохранённого файла, ни неоконченной отправки.
import type { ApplicationDocumentItemTarget, ApplicationDocumentSelection } from "@web/lib/portal/application-documents";
import { useRef, useState } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { submitApplicationDocument } from "@/api/preparations-documents";
import { DiscardPending } from "@/features/preparations/DiscardPending";
import { runSubmit } from "@/features/preparations/document-commands";
import { documentsPending, isSubmitIntent } from "@/features/preparations/documents-pending";
import { usePreparation } from "@/features/preparations/context";
import { documentActionMessage } from "@/features/preparations/messages";
import { usePending } from "@/features/preparations/pending-store";
import { useLang } from "@/i18n/LangProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

export function SubmitControl({ target, selection, previousSubmissionId, disabled = false, suppressed = false, confirmationShown = false, onAttempt, onSent, onBusyChange }: {
  target: ApplicationDocumentItemTarget;
  selection: ApplicationDocumentSelection | null;
  previousSubmissionId: string | null;
  disabled?: boolean;
  /** Одно нажатие этого требования идёт: запрос отправки, который оно записало, не «неоконченный», и рядом ничего не отправляется. */
  suppressed?: boolean;
  /** Требование уже показывает строку «отправлено»: здесь она не повторяется. */
  confirmationShown?: boolean;
  /** Отправка началась: прежнее «сохранён, не отправлен» не должно её пережить. */
  onAttempt?: () => void;
  /** Подтверждение, которое должно пережить обновление после записи. */
  onSent?: (documentVersionId: string, text: string) => void;
  /** Эта отправка идёт: запрос, который она записала, её собственный. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const { scope, strings, onSaved } = usePreparation();
  const api = usePortalApi();
  const { m } = useLang();
  const pending = usePending(documentsPending, scope, "submit", target.requirementItemId);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const retained = !suppressed && isSubmitIntent(pending.intent) ? pending.intent : null;
  // Нечитаемая (повреждённая) запись: повтор не поможет, её можно только снять. «Хранилище не ответило» - другое состояние.
  const corrupt = pending.blocked && !pending.unavailable;

  async function submit() {
    if (sending.current || suppressed || pending.blocked || !pending.hydrated || (!retained && (disabled || !selection))) return;
    sending.current = true;
    setBusy(true);
    setMessage(null);
    setSucceeded(false);
    try {
      onAttempt?.();
    } catch {
      // Показ только.
    }
    // «Проверить результат» дописывает начатое: у требования остаётся его двухшаговый вид.
    const reportBusy = !retained;
    if (reportBusy) {
      try {
        onBusyChange?.(true);
      } catch {
        // Показ только.
      }
    }
    // Сохранённый запрос повторяется как был записан, иначе уходит текущий выбор.
    const sentVersionId = (retained?.selection ?? selection)?.documentVersionId ?? null;
    try {
      const outcome = await runSubmit({ scope, target, selection, previousSubmissionId, whenRetained: "resend", submit: (intent) => submitApplicationDocument(api.transport, intent) });
      switch (outcome.status) {
        case "sent": {
          const text = outcome.cleared ? strings.sent : `${strings.sent} ${strings.cleanupFailed}`;
          setSucceeded(true);
          setMessage(text);
          announce(text);
          if (sentVersionId) {
            try {
              onSent?.(sentVersionId, text);
            } catch {
              // Показ только.
            }
          }
          try {
            onSaved();
          } catch {
            // Точная квитанция уже известна.
          }
          break;
        }
        case "rejected": {
          const text = documentActionMessage(outcome.reason, strings);
          setMessage(text);
          announce(text);
          break;
        }
        case "locked": {
          const text = outcome.reason === "busy" ? strings.pending : strings.storageUnavailable;
          setMessage(text);
          announce(text);
          break;
        }
        case "unknown":
          setMessage(strings.unavailable);
          announce(strings.unavailable);
          break;
        default:
          break;
      }
    } catch {
      setMessage(strings.unavailable);
      announce(strings.unavailable);
    } finally {
      sending.current = false;
      setBusy(false);
      if (reportBusy) {
        try {
          onBusyChange?.(false);
        } catch {
          // Показ только.
        }
      }
    }
  }

  // Повтор того же запроса ничего не меняет в требовании, пересоздания нет, и «отправлено» у требования уже на виду.
  const shownMessage = message && !(succeeded && confirmationShown) ? message : null;
  if (!retained && !selection && !pending.blocked && !busy && !shownMessage) return null;
  return (
    <View style={{ gap: 8 }} accessibilityState={{ busy }} testID={`prep-submit-${target.requirementItemId}`}>
      {retained && !succeeded ? <Text variant="secondary" testID={`prep-submit-retained-${target.requirementItemId}`}>{strings.pending}</Text> : null}
      {corrupt ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert" testID={`prep-submit-unreadable-${target.requirementItemId}`}>
          {m("prep.recordUnreadable")}
        </Text>
      ) : null}
      {pending.unavailable ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert" testID={`prep-submit-storage-${target.requirementItemId}`}>
          {strings.storageUnavailable}
        </Text>
      ) : null}
      <Button
        label={busy ? strings.sending : retained ? strings.retry : strings.send}
        // Рядом может стоять такая же «Проверить результат» у загрузки: читалке нужно знать, чей это результат.
        accessibilityLabel={retained && !busy ? m("prep.retrySubmitAria") : undefined}
        onPress={() => void submit()}
        disabled={!pending.hydrated || busy || suppressed || pending.blocked || (!retained && (disabled || !selection))}
        testID={`prep-submit-button-${target.requirementItemId}`}
      />
      {/* Повторить испорченную запись нельзя; неоконченную, но читаемую отправку доводит «Проверить результат», отказ ей не нужен. */}
      {corrupt ? (
        <DiscardPending
          operation="submit"
          target={target.requirementItemId}
          disabled={!pending.hydrated || busy || suppressed}
          onDiscarded={(text) => {
            setMessage(text);
            setSucceeded(true);
          }}
          testID={`prep-discard-submit-${target.requirementItemId}`}
        />
      ) : null}
      {shownMessage ? (
        <Text variant="secondary" tone={succeeded ? "text2" : "error"} accessibilityRole={succeeded ? undefined : "alert"} testID={`prep-submit-message-${target.requirementItemId}`}>
          {shownMessage}
        </Text>
      ) : null}
    </View>
  );
}
