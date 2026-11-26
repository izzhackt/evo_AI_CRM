// Неоконченные записи документов, которых нет среди требований на экране (их цель из прежней ревизии требований) или чьё
// хранилище не читается. Студент доводит их здесь: повторяет сохранение с тем же файлом или проверяет результат отправки.
// Веб: `ProgramDocumentRecovery.tsx`.
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import type { ApplicationDocumentSubmitIntent } from "@web/lib/portal/application-documents";

import { usePortalApi } from "@/api/PortalApi";
import { submitApplicationDocument } from "@/api/preparations-documents";
import { runSubmit } from "@/features/preparations/document-commands";
import { documentsPending, isSubmitIntent, isUploadIntent, type DocumentOperation, type DocumentPendingIntent } from "@/features/preparations/documents-pending";
import { usePreparation } from "@/features/preparations/context";
import { DiscardPending } from "@/features/preparations/DiscardPending";
import { documentActionMessage } from "@/features/preparations/messages";
import type { PendingEntry } from "@/features/preparations/pending-store";
import { UploadControl } from "@/features/preparations/UploadControl";
import { useLang } from "@/i18n/LangProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

type Entry = PendingEntry<DocumentOperation, DocumentPendingIntent>;

function RecoverEntry({ entry }: { entry: Entry }) {
  const { scope, strings, onSaved } = usePreparation();
  const api = usePortalApi();
  const { m } = useLang();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const lock = useRef(false);
  const intent = entry.intent;

  async function retry(submit: ApplicationDocumentSubmitIntent) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    setSucceeded(false);
    try {
      const outcome = await runSubmit({
        scope,
        target: { studentCaseId: submit.studentCaseId, applicationId: submit.applicationId, requirementsRevisionId: submit.requirementsRevisionId, requirementItemId: submit.requirementItemId },
        selection: null,
        previousSubmissionId: null,
        whenRetained: "resend",
        submit: (value) => submitApplicationDocument(api.transport, value),
      });
      let text: string | null = null;
      switch (outcome.status) {
        case "sent":
          setSucceeded(true);
          text = outcome.cleared ? strings.sent : `${strings.sent} ${strings.cleanupFailed}`;
          try {
            onSaved();
          } catch {
            // Подтверждённая квитанция остаётся подтверждённой.
          }
          break;
        case "rejected":
          text = documentActionMessage(outcome.reason, strings);
          break;
        case "locked":
          text = outcome.reason === "busy" ? strings.pending : strings.storageUnavailable;
          break;
        case "unknown":
          text = strings.unavailable;
          break;
        default:
          break;
      }
      setMessage(text);
      announce(text);
    } catch {
      setMessage(strings.unavailable);
      announce(strings.unavailable);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  if (entry.blocked || !intent) {
    // Испорченную запись не повторить и не стереть втихую: текст говорит прямо, а снять её можно только отказом.
    return (
      <View style={{ gap: 8 }}>
        <Text variant="secondary" tone="error" accessibilityRole="alert">
          {m("prep.recordUnreadable")}
        </Text>
        <DiscardPending operation={entry.operation} target={entry.target} testID={`prep-discard-recover-${entry.operation}-${entry.target}`} />
      </View>
    );
  }
  if (isUploadIntent(intent)) {
    return (
      <UploadControl
        target={{ studentCaseId: intent.studentCaseId, applicationId: intent.applicationId, requirementsRevisionId: intent.requirementsRevisionId, requirementItemId: intent.requirementItemId, documentSlotId: intent.documentSlotId }}
        label={intent.file.originalFilename}
      />
    );
  }
  if (!isSubmitIntent(intent)) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="secondary">{strings.pending}</Text>
      <Button variant="ghost" label={busy ? strings.sending : strings.retry} onPress={() => void retry(intent)} disabled={busy} testID={`prep-recover-${entry.operation}-${entry.target}`} />
      {message ? (
        <Text variant="secondary" tone={succeeded ? "text2" : "error"} accessibilityRole={succeeded ? undefined : "alert"}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

export function DocumentRecovery({ currentItemIds, loading }: {
  currentItemIds: readonly string[];
  /**
   * Первое чтение требований ещё идёт: какие записи относятся к видимым требованиям, пока неизвестно. Без этого запись каждого
   * требования мигала бы здесь «прежней» (с лишней кнопкой «Проверить результат» и отказом) до ответа сервера, и тот же
   * экран нажимался бы дважды в разных местах. Веб этого не знает: страница получает первый ответ вместе с разметкой.
   */
  loading: boolean;
}) {
  const { scope, strings } = usePreparation();
  const [entries, setEntries] = useState<readonly Entry[] | "unavailable">([]);
  const { organizationId, membershipId, studentCaseId, applicationId } = scope;
  useEffect(() => {
    let alive = true;
    let sequence = 0;
    const address = { organizationId, membershipId, studentCaseId, applicationId };
    const load = () => {
      const mine = ++sequence;
      documentsPending.list(address).then(
        (value) => {
          if (alive && mine === sequence) setEntries(value);
        },
        () => {
          if (alive && mine === sequence) setEntries("unavailable");
        },
      );
    };
    load();
    const off = documentsPending.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, [organizationId, membershipId, studentCaseId, applicationId]);
  if (entries === "unavailable") {
    return (
      <Text variant="secondary" tone="error" accessibilityRole="alert" testID="prep-recovery-unavailable">
        {strings.storageUnavailable}
      </Text>
    );
  }
  if (loading) return null;
  // Записи видимых требований доводят сами требования, в том числе нечитаемые (у требования свой текст и свой отказ): здесь они
  // были бы второй копией с второй кнопкой. Здесь остальные записи; а пока список требований не прочитан или не прочитался,
  // видимых требований нет, и здесь все записи, чтобы довести начатое можно было и без списка.
  const hidden = entries.filter((entry) => !currentItemIds.includes(entry.target));
  if (hidden.length === 0) return null;
  return (
    <View style={{ gap: 8 }} testID="prep-recovery">
      <Text variant="heading" accessibilityRole="header">
        {strings.retry}
      </Text>
      {hidden.map((entry) => (
        <RecoverEntry key={`${entry.operation}:${entry.target}`} entry={entry} />
      ))}
    </View>
  );
}
