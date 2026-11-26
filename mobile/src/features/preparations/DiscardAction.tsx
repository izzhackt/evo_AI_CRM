// Кнопка «Отказаться от незавершённого действия» с окном подтверждения: общая часть для документов (`DiscardPending`) и для
// комплекта (`PackageRecovery`). Только в приложении: на сайте запись лежит в браузере и уходит очисткой данных. Нужна там,
// где запись нельзя довести: неоконченная загрузка ждёт ТОТ ЖЕ файл (снимок с камеры повторить нельзя), нечитаемая запись
// не читается вовсе, и повтор ей не поможет. Что именно снимается, решает вызывающий (`discard`): всегда одна запись, чужие
// цели, программы и участники не трогаются. Окно подтверждения обязательно: после снятия телефон больше не проверяет, дошло
// ли действие до EVO. Идущую команду кнопка не прерывает: хранилище отвечает «занято», и студент читает, что надо подождать.
import { useRef, useState } from "react";
import { Alert, View } from "react-native";

import type { DiscardResult } from "@/features/preparations/pending-store";
import { useLang } from "@/i18n/LangProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

export function DiscardAction({ label, body, discard, disabled = false, onDiscarded, testID }: {
  /** Подпись кнопки: что именно отменяется («…незавершённой загрузки», «…отправки комплекта»). */
  label: string;
  /** Текст окна подтверждения: что может случиться, если действие уже дошло до EVO (больше ничего не обещается). */
  body: string;
  /** Снять запись: `store.discard(scope, operation, target)`; вызывается только после подтверждения. */
  discard: () => Promise<DiscardResult>;
  /** Идёт действие над этой записью или она ещё не прочитана. */
  disabled?: boolean;
  /** Запись снята; текст уже озвучен, а владелец может показать его у себя (сама кнопка после снятия исчезает). */
  onDiscarded?: (text: string) => void;
  testID: string;
}) {
  const { m } = useLang();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function run() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await discard();
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

  function ask() {
    if (lock.current || disabled) return;
    Alert.alert(m("prep.discardTitle"), body, [
      { text: m("prep.discardKeep"), style: "cancel" },
      { text: m("prep.discardConfirm"), style: "destructive", onPress: () => void run() },
    ]);
  }

  return (
    <View style={{ gap: 6 }}>
      <Button variant="ghost" label={label} onPress={ask} disabled={disabled || busy} testID={testID} />
      {failure ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert" testID={`${testID}-error`}>
          {failure}
        </Text>
      ) : null}
    </View>
  );
}
