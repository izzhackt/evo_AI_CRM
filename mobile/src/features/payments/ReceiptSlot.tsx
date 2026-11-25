// Ячейка «Чек» у строки платежа: выбрать файл и «Сохранить» (веб: ReceiptSlot в PaymentReceiptForm.tsx, #1452).
// Только файл (решение владельца 25.11, как на сайте): сумма, валюта, день и платёж берутся из строки
// (`receiptInputForLine`), студент их не вводит. Кнопку («+ Приложить чек» к остатку или «Заменить» у отклонённого) решает
// общий модуль веба (`PaymentLine.attach` / `replace`), здесь только показ и отправка.
// Идущая отправка не обрывается, когда слот исчезает (строку заменили свежие данные, студент ушёл с экрана): как на сайте, она
// доходит до конца, список перечитывается (`invalidate`), а чек не теряется молча. Токены у неё привязаны к студенту, который её
// начал (`ownerBoundTokens`): после выхода и входа другого студента она не берёт его сессию.
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { useInvalidatePaymentCenter } from "@/api/queries";
import type { PaymentLineView } from "@/domain/payments-model";
import { SourceSheet } from "@/features/documents/SourceSheet";
import type { PaymentsIo } from "@/features/payments/io";
import { PickedFileChip } from "@/features/payments/PickedFileChip";
import { receiptInputForLine, ReceiptUploadController } from "@/features/payments/receipt-upload";
import { SlotButton } from "@/features/payments/SlotButton";
import { ownerBoundTokens } from "@/features/payments/upload-session";
import { useAnnounceProblem } from "@/features/payments/use-announce-problem";
import { pickNoticeText, useFilePick } from "@/features/payments/use-file-pick";
import { useLang } from "@/i18n/LangProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

export function ReceiptSlot({ io, view, mode, testID }: { io: PaymentsIo; view: PaymentLineView; mode: "attach" | "replace"; testID: string }) {
  const { m, t } = useLang();
  const api = usePortalApi();
  const invalidate = useInvalidatePaymentCenter();
  const strings = t("admission");
  const [controller] = useState(() => {
    const tokens = ownerBoundTokens(api, () => io.liveUserId());
    return new ReceiptUploadController(io.createReceiptSend(api.portalBaseUrl, tokens.getToken, tokens.refreshToken), randomUUID, invalidate);
  });
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  // Момент первого «Сохранить» для этого файла: от него считается день чека (см. `save`). Другой файл - другая отправка, момент забывается.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const fileChanged = useCallback(() => {
    setSavedAt(null);
    controller.clearMessage();
  }, [controller, setSavedAt]);
  const pick = useFilePick(io, fileChanged);
  const sent = state.status === "success";
  const busy = state.status === "sending";
  const failed = state.status === "error" ? state : null;
  const problem = pickNoticeText(pick.notice, m, strings) ?? (failed ? strings[failed.error] : null);

  useAnnounceProblem(problem, failed, pick.noticeSeq);
  useEffect(() => {
    if (sent) announce(strings.receiptSent);
  }, [sent, strings.receiptSent]);

  if (sent) {
    return (
      <Text variant="secondary" tone="ok" bold accessibilityRole="alert" accessibilityLiveRegion="polite" testID={`${testID}-sent`} style={{ flexShrink: 1 }}>
        {strings.receiptSent}
      </Text>
    );
  }

  const label = mode === "replace" ? strings.replaceButton : strings.receiptAttach;
  // День чека - сегодня по Бишкеку на момент нажатия «Сохранить», как на сайте. Пока исход прежней отправки неизвестен (обрыв сети,
  // ключ повтора жив), повтор берёт тот же момент: тело и ключ те же и после полуночи, второго чека не будет. Новая отправка
  // (первое нажатие, другой файл, повтор после окончательного отказа) берёт сегодняшний момент заново.
  const save = () => {
    const at = savedAt !== null && controller.currentKey() !== null ? savedAt : Date.now();
    setSavedAt(at);
    controller.submit(receiptInputForLine(view.line, pick.file, at));
  };

  return (
    <View style={{ gap: 6, flexShrink: 1 }} testID={testID}>
      {pick.file ? (
        <View style={{ gap: 8 }}>
          <PickedFileChip
            name={pick.file.name}
            onClear={() => {
              pick.clear();
              fileChanged();
            }}
            disabled={busy}
            testID={`${testID}-file`}
          />
          <View style={{ flexDirection: "row" }}>
            <Button label={busy ? strings.receiptSaving : strings.receiptSave} busy={busy} onPress={save} testID={`${testID}-save`} />
          </View>
        </View>
      ) : (
        <SlotButton look={mode === "replace" ? "text" : "dashed"} label={label} accessibilityLabel={`${label}: ${view.context}`} onPress={pick.openSheet} disabled={busy} testID={`${testID}-${mode}`} />
      )}
      {busy ? (
        <Text variant="caption" tone="text2" accessibilityLiveRegion="polite" testID={`${testID}-progress`}>
          {strings.receiptSaving} {state.status === "sending" && state.progress > 0 ? `${state.progress}%` : ""}
        </Text>
      ) : null}
      {problem ? (
        <Text variant="secondary" tone="error" bold accessibilityRole="alert" testID={`${testID}-error`}>
          {problem}
        </Text>
      ) : null}
      <SourceSheet visible={pick.sheet} title={strings.receiptFieldFile} onPick={pick.onPick} onClose={pick.closeSheet} onDismissed={pick.flush} />
    </View>
  );
}
