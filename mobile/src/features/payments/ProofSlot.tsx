// «Приложить чек» у принятой оплаты без файла (веб: ProofSlot в PaymentReceiptForm.tsx, #1458, миграция 360).
// Только файл: сумма, дата и статус не меняются, куратор ничего не проверяет. Выбор файла - лист «файл, фото, камера».
// Когда файл сохранён, слот сообщает об этом строке (`onAttached`): строка показывает ссылку на файл и «Чек приложен» и держит их,
// пока открыта страница, даже когда перечитанные данные уже дали записи файл и слот исчез (G34 аудита паритета).
// Идущая отправка не обрывается, когда слот исчезает: как на сайте, она доходит до конца и список перечитывается (`invalidate`).
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import type { PaymentProofResult } from "@web/lib/portal/payment-proof";

import { usePortalApi } from "@/api/PortalApi";
import { useInvalidatePaymentCenter } from "@/api/queries";
import { SourceSheet } from "@/features/documents/SourceSheet";
import type { PaymentsIo } from "@/features/payments/io";
import { PickedFileChip } from "@/features/payments/PickedFileChip";
import { ProofUploadController } from "@/features/payments/proof-upload";
import { SlotButton } from "@/features/payments/SlotButton";
import { useAnnounceProblem } from "@/features/payments/use-announce-problem";
import { pickNoticeText, useFilePick } from "@/features/payments/use-file-pick";
import { useLang } from "@/i18n/LangProvider";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

export function ProofSlot({
  io,
  paymentEventId,
  lineKey,
  context,
  testID,
  onAttached,
}: {
  io: PaymentsIo;
  paymentEventId: string;
  /** Ключ строки таблицы: под ним экран запоминает, что файл приложен. */
  lineKey: string;
  context: string;
  testID: string;
  /** Файл сохранён: `result` - ответ сервера (имя и идентификатор файла), `null` - ответ не той формы, ссылку подтянут данные. Стабильная функция. */
  onAttached: (lineKey: string, result: PaymentProofResult | null) => void;
}) {
  const { m, t } = useLang();
  const api = usePortalApi();
  const invalidate = useInvalidatePaymentCenter();
  const strings = t("admission");
  const [controller] = useState(() => new ProofUploadController(io.createProofSend(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), randomUUID, invalidate));
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const clearMessage = useCallback(() => controller.clearMessage(), [controller]);
  const pick = useFilePick(io, clearMessage);

  const busy = state.status === "sending";
  const failed = state.status === "error" ? state : null;
  const errorText = failed ? ((strings as Record<string, string>)[failed.error] ?? strings.receiptErrorUnavailable) : null;
  const problem = pickNoticeText(pick.notice, m, strings) ?? errorText;
  useAnnounceProblem(problem, failed, pick.noticeSeq);
  // Сохранён файл: строка запоминает это и держит «Чек приложен» с ссылкой после перечитывания. «Файл уже есть» (409) - не успех слота:
  // состояние остаётся «пусто», данные перечитываются, и строка просто показывает файл.
  useEffect(() => {
    if (state.status === "success") onAttached(lineKey, state.result);
  }, [state, lineKey, onAttached]);

  if (state.status === "success") {
    return (
      <Text variant="secondary" tone="ok" bold accessibilityRole="alert" accessibilityLiveRegion="polite" testID={`${testID}-sent`}>
        {strings.proofAttached}
      </Text>
    );
  }

  return (
    <View style={{ gap: 6, flexShrink: 1 }} testID={testID}>
      {pick.file ? (
        <View style={{ gap: 8 }}>
          <PickedFileChip
            name={pick.file.name}
            onClear={() => {
              pick.clear();
              controller.clearMessage();
            }}
            disabled={busy}
            testID={`${testID}-file`}
          />
          <View style={{ flexDirection: "row" }}>
            <Button label={busy ? strings.receiptSaving : strings.receiptSave} busy={busy} onPress={() => controller.submit(paymentEventId, pick.file)} testID={`${testID}-save`} />
          </View>
        </View>
      ) : (
        <SlotButton look="dashed" label={strings.receiptAttach} accessibilityLabel={`${strings.receiptAttach}: ${context}`} onPress={pick.openSheet} disabled={busy} testID={`${testID}-attach`} />
      )}
      {busy ? (
        <Text variant="caption" tone="text2" accessibilityLiveRegion="polite">
          {strings.receiptSaving} {state.status === "sending" && state.progress > 0 ? `${state.progress}%` : ""}
        </Text>
      ) : null}
      {problem ? (
        <Text variant="secondary" tone="error" bold accessibilityRole="alert" testID={`${testID}-error`}>
          {problem}
        </Text>
      ) : null}
      <SourceSheet visible={pick.sheet} title={strings.receiptAttach} onPick={pick.onPick} onClose={pick.closeSheet} onDismissed={pick.flush} />
    </View>
  );
}
