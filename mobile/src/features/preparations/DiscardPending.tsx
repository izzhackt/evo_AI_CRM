// «Отказаться от незавершённой загрузки / отправки»: снять запись ОДНОГО требования после подтверждения. Только в приложении:
// на сайте запись живёт в браузере и уходит очисткой данных. Нужна там, где запись нельзя довести: неоконченная загрузка ждёт
// ТОТ ЖЕ файл (снимок с камеры повторить нельзя, а другой файл получает «Это другой файл»), испорченная запись не читается
// вовсе, и повтор ей не поможет. Снимается только запись этой операции этого требования: другие требования и запись другой
// операции не трогаются (`documentsPending.discard`).
import { useRef, useState } from "react";
import { Alert, View } from "react-native";

import { usePreparation } from "@/features/preparations/context";
import { documentsPending, type DocumentOperation } from "@/features/preparations/documents-pending";
import { useLang } from "@/i18n/LangProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

export function DiscardPending({ operation, target, disabled = false, onDiscarded, testID }: {
  operation: DocumentOperation;
  /** Требование, чья запись снимается. */
  target: string;
  /** Идёт действие над этим требованием, или запись ещё не прочитана. */
  disabled?: boolean;
  /** Запись снята; текст уже озвучен, а форма может показать его у себя (сама кнопка после снятия исчезает). */
  onDiscarded?: (text: string) => void;
  testID: string;
}) {
  const { scope } = usePreparation();
  const { m } = useLang();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function discard() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await documentsPending.discard(scope, operation, target);
      if (result.ok) {
        const text = m("prep.discarded");
        announce(text);
        try {
          onDiscarded?.(text);
        } catch {
          // Показ только: запись уже снята.
        }
      } else {
        const text = result.reason === "busy" ? m("prep.discardBusy") : m("prep.storageUnavailable");
        setFailure(text);
        announce(text);
      }
    } catch {
      const text = m("prep.storageUnavailable");
      setFailure(text);
      announce(text);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  // Подтверждение обязательно: после снятия телефон больше не проверяет, дошло ли действие до EVO.
  function ask() {
    if (lock.current || disabled) return;
    Alert.alert(m("prep.discardTitle"), m(operation === "upload" ? "prep.discardUploadBody" : "prep.discardSubmitBody"), [
      { text: m("prep.discardKeep"), style: "cancel" },
      { text: m("prep.discardConfirm"), style: "destructive", onPress: () => void discard() },
    ]);
  }

  return (
    <View style={{ gap: 6 }}>
      <Button variant="ghost" label={m(operation === "upload" ? "prep.discardUpload" : "prep.discardSubmit")} onPress={ask} disabled={disabled || busy} testID={testID} />
      {failure ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert" testID={`${testID}-error`}>
          {failure}
        </Text>
      ) : null}
    </View>
  );
}
