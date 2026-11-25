// «Добавить платёж»: сумма, валюта, дата и чек для платежа вне графика (веб: AddPaymentForm в PaymentReceiptForm.tsx, #1452).
// Единственное место, где студент сам вводит сумму, валюту и день: у платежа вне графика их взять не из чего. Чек уходит тем же
// маршрутом, что чек у строки, без платежа; куратор относит его сам («Добавленные платежи»).
// Календаря браузера в приложении нет (новый нативный модуль запрещён заморозкой сборки), поэтому день печатают: он уже подставлен
// (сегодня по Бишкеку) и в формате «дд.мм.гггг», как все даты страницы; «гггг-мм-дд» тоже принимается. День подставляется один раз, когда
// форма открывается, и дальше только меняется рукой: повтор после обрыва сети уходит с тем же телом и тем же ключом, даже после полуночи.
// Идущая отправка не обрывается, когда форма исчезает: как на сайте, она доходит до конца и список перечитывается (`invalidate`).
// Пока идёт отправка, экран получает `onBusyChange(true)` и не даёт нажать «Добавить платёж» в шапке (закрыть форму посреди отправки).
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { useInvalidatePaymentCenter } from "@/api/queries";
import { formatEntryDay } from "@/domain/payments-model";
import { SourceSheet } from "@/features/documents/SourceSheet";
import type { PaymentsIo } from "@/features/payments/io";
import { PickedFileChip } from "@/features/payments/PickedFileChip";
import { ReceiptUploadController, todayInBishkek } from "@/features/payments/receipt-upload";
import { SlotButton } from "@/features/payments/SlotButton";
import { useAnnounceProblem } from "@/features/payments/use-announce-problem";
import { pickNoticeText, useFilePick } from "@/features/payments/use-file-pick";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export function AddPaymentForm({
  io,
  currencies,
  defaultCurrency,
  onClose,
  onBusyChange,
}: {
  io: PaymentsIo;
  currencies: readonly string[];
  defaultCurrency: string;
  onClose: () => void;
  /** Идёт ли отправка: экран на это время отключает кнопку «Добавить платёж» в шапке. Стабильная функция. */
  onBusyChange: (busy: boolean) => void;
}) {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const api = usePortalApi();
  const invalidate = useInvalidatePaymentCenter();
  const strings = t("admission");
  const [controller] = useState(() => new ReceiptUploadController(io.createReceiptSend(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), randomUUID, invalidate));
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [paidOn, setPaidOn] = useState(() => formatEntryDay(todayInBishkek()));
  const clearMessage = useCallback(() => controller.clearMessage(), [controller]);
  const pick = useFilePick(io, clearMessage);
  const sent = state.status === "success";
  const busy = state.status === "sending";
  const failed = state.status === "error" ? state : null;
  const problem = pickNoticeText(pick.notice, m, strings) ?? (failed ? strings[failed.error] : null);

  useAnnounceProblem(problem, failed, pick.noticeSeq);
  useEffect(() => {
    if (sent) announce(strings.receiptSent);
  }, [sent, strings.receiptSent]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  if (sent) {
    return (
      <Text variant="secondary" tone="ok" bold accessibilityRole="alert" accessibilityLiveRegion="polite" testID="payment-add-sent">
        {strings.receiptSent}
      </Text>
    );
  }

  const edited = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    controller.clearMessage();
  };

  return (
    <View testID="payment-add-form" style={{ gap: 12, padding: 12, borderRadius: tokens.radiusItem, backgroundColor: tokens.bg }}>
      <TextField
        label={strings.receiptFieldAmount}
        value={amount}
        onChangeText={edited(setAmount)}
        keyboardType="decimal-pad"
        placeholder="0.00"
        autoComplete="off"
        autoFocus
        editable={!busy}
        testID="payment-add-amount"
      />

      <View style={{ gap: 8 }}>
        {/* Быстрый выбор вместо `<datalist>` сайта: валюты платежей и чеков. Одна валюта уже стоит в поле, кнопка ничего не добавила бы. */}
        <TextField
          label={strings.receiptFieldCurrency}
          value={currency}
          onChangeText={(value) => edited(setCurrency)(value.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={3}
          editable={!busy}
          testID="payment-add-currency"
        />
        {currencies.length > 1 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {currencies.map((code) => {
              const selected = currency.trim().toUpperCase() === code;
              return (
                <Pressable
                  key={code}
                  accessibilityRole="button"
                  accessibilityLabel={`${strings.receiptFieldCurrency}: ${code}`}
                  accessibilityState={{ selected, disabled: busy }}
                  disabled={busy}
                  onPress={() => edited(setCurrency)(code)}
                  testID={`payment-add-currency-${code}`}
                  style={{
                    minHeight: MIN_TARGET,
                    minWidth: MIN_TARGET,
                    paddingHorizontal: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: tokens.radiusChip,
                    borderWidth: 1,
                    borderColor: selected ? tokens.accent : tokens.line,
                    backgroundColor: selected ? tokens.accentSoft : tokens.surface,
                  }}
                >
                  <Text variant="secondary" bold tone={selected ? "accent" : "text"}>
                    {code}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <TextField
        label={strings.receiptFieldDate}
        value={paidOn}
        onChangeText={edited(setPaidOn)}
        placeholder={m("pay.dateHint")}
        keyboardType="numbers-and-punctuation"
        autoCorrect={false}
        maxLength={10}
        editable={!busy}
        testID="payment-add-date"
      />

      <View style={{ gap: 6 }}>
        <Text variant="secondary" tone="text2" bold>
          {strings.receiptColumnReceipt}
        </Text>
        {pick.file ? (
          <PickedFileChip name={pick.file.name} onClear={() => { pick.clear(); controller.clearMessage(); }} disabled={busy} testID="payment-add-file" />
        ) : (
          <SlotButton look="dashed" label={strings.receiptAttach} onPress={pick.openSheet} disabled={busy} testID="payment-add-pick" />
        )}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button label={busy ? strings.receiptSaving : strings.receiptSave} busy={busy} onPress={() => controller.submit({ file: pick.file, amount, currency, paidOn, obligationId: null })} testID="payment-add-save" />
        <Button variant="ghost" label={strings.receiptCancel} onPress={onClose} disabled={busy} testID="payment-add-cancel" />
      </View>

      <Text variant="caption" tone="text2">
        {strings.receiptAddHint}
      </Text>
      {busy ? (
        <Text variant="caption" tone="text2" accessibilityLiveRegion="polite" testID="payment-add-progress">
          {strings.receiptSaving} {state.status === "sending" && state.progress > 0 ? `${state.progress}%` : ""}
        </Text>
      ) : null}
      {problem ? (
        <Text variant="secondary" tone="error" bold accessibilityRole="alert" testID="payment-add-error">
          {problem}
        </Text>
      ) : null}
      <SourceSheet visible={pick.sheet} title={strings.receiptFieldFile} onPick={pick.onPick} onClose={pick.closeSheet} onDismissed={pick.flush} />
    </View>
  );
}
