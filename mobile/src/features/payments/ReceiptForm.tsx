// Форма «Приложить чек»: сумма, валюта, дата и файл (PDF, JPG, PNG) в самой карточке, без модального окна.
// Логика отправки: receipt-upload.ts (ключ идемпотентности, проверки, коды ошибок); здесь только ввод и показ.
// Выбор файла - лист «файл, фото, камера» экрана «Документы».
import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, TextInput, View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { useInvalidatePaymentCenter } from "@/api/queries";
import type { PickedFile, PickSource } from "@/domain/documents-model";
import { SourceSheet } from "@/features/documents/SourceSheet";
import type { PaymentsIo } from "@/features/payments/io";
import { ReceiptUploadController, todayInBishkek, type ReceiptField } from "@/features/payments/receipt-upload";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export type ReceiptFormProps = Readonly<{
  io: PaymentsIo;
  /** Платёж, к которому прикладывается чек; `null` - чек без платежа. */
  obligationId: string | null;
  /** Валюта платежа (поле закрыто) или `null` (вводит студент). */
  fixedCurrency: string | null;
  initialCurrency: string;
  initialAmount: string;
  initialDate?: string;
  idPrefix: string;
  onSent: () => void;
  onCancel: () => void;
}>;

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

type Notice = "camera" | "pick" | null;

export function ReceiptForm({ io, obligationId, fixedCurrency, initialCurrency, initialAmount, initialDate, idPrefix, onSent, onCancel }: ReceiptFormProps) {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const api = usePortalApi();
  const invalidate = useInvalidatePaymentCenter();
  const strings = t("admission");
  const [controller] = useState(
    () =>
      new ReceiptUploadController(
        io.createReceiptSend(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken),
        randomUUID,
        () => {
          invalidate();
          onSent();
        },
      ),
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [amount, setAmount] = useState(initialAmount);
  const [currency, setCurrency] = useState(fixedCurrency ?? initialCurrency);
  const [paidOn, setPaidOn] = useState(initialDate ?? todayInBishkek());
  const [file, setFile] = useState<PickedFile | null>(null);
  const [sheet, setSheet] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const pending = useRef<PickSource | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      controller.cancel();
    },
    [controller],
  );

  const busy = state.status === "sending";
  const failed = state.status === "error" ? state : null;
  const fieldError = (field: ReceiptField) => failed?.field === field;

  const runPick = useCallback(
    async (source: PickSource) => {
      setNotice(null);
      const outcome = await io.pick(source);
      if (outcome.kind === "picked") {
        setFile(outcome.file);
        controller.clearMessage();
      } else if (outcome.kind === "denied") setNotice("camera");
      else if (outcome.kind === "failed") setNotice("pick");
    },
    [io, controller],
  );
  // iOS не показывает системный выбор, пока закрывается лист: ждём onDismiss (запасной таймер на случай, если он не пришёл).
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const source = pending.current;
    pending.current = null;
    if (source) void runPick(source);
  }, [runPick]);
  const onPick = (source: PickSource) => {
    pending.current = source;
    setSheet(false);
    if (Platform.OS === "ios") timer.current = setTimeout(flush, 700);
    else flush();
  };

  const submit = () => controller.submit({ file, amount, currency, paidOn, obligationId });

  const inputStyle = (field: ReceiptField) => ({
    minHeight: MIN_TARGET,
    borderWidth: 1,
    borderColor: fieldError(field) ? tokens.error : tokens.line,
    borderRadius: tokens.radiusControl,
    paddingHorizontal: 12,
    color: tokens.text,
    backgroundColor: tokens.surface,
    fontFamily: sansFont(),
    fontSize: tokens.sizeBody,
  });
  const label = (text: string) => (
    <Text variant="caption" tone="text2" bold>
      {text}
    </Text>
  );

  return (
    <View testID={`${idPrefix}-form`} style={{ gap: 12, padding: 12, borderRadius: tokens.radiusControl, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.accentSoft }}>
      <Text variant="secondary" tone="text2">
        {strings.receiptDialogLead}
      </Text>

      <View style={{ gap: 4 }}>
        {label(strings.receiptFieldAmount)}
        <TextInput
          testID={`${idPrefix}-amount`}
          accessibilityLabel={strings.receiptFieldAmount}
          value={amount}
          onChangeText={(value) => {
            setAmount(value);
            controller.clearMessage();
          }}
          keyboardType="decimal-pad"
          editable={!busy}
          placeholderTextColor={tokens.text2}
          style={inputStyle("amount")}
        />
      </View>

      <View style={{ gap: 4 }}>
        {label(strings.receiptFieldCurrency)}
        {fixedCurrency ? (
          <Text variant="body" bold testID={`${idPrefix}-currency`} style={{ minHeight: 28 }}>
            {fixedCurrency}
          </Text>
        ) : (
          <TextInput
            testID={`${idPrefix}-currency`}
            accessibilityLabel={strings.receiptFieldCurrency}
            value={currency}
            onChangeText={(value) => {
              setCurrency(value.toUpperCase());
              controller.clearMessage();
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={3}
            editable={!busy}
            style={inputStyle("currency")}
          />
        )}
      </View>

      <View style={{ gap: 4 }}>
        {label(strings.receiptFieldDate)}
        <TextInput
          testID={`${idPrefix}-date`}
          accessibilityLabel={strings.receiptFieldDate}
          value={paidOn}
          onChangeText={(value) => {
            setPaidOn(value);
            controller.clearMessage();
          }}
          placeholder="2026-01-31"
          placeholderTextColor={tokens.text2}
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          maxLength={10}
          editable={!busy}
          style={inputStyle("date")}
        />
      </View>

      <View style={{ gap: 4 }}>
        {label(strings.receiptFieldFile)}
        <Button
          variant="ghost"
          label={file ? `${file.name} · ${fileSize(file.size)}` : strings.receiptFieldFile}
          accessibilityLabel={file ? `${strings.receiptFieldFile}: ${file.name}` : strings.receiptFieldFile}
          onPress={() => setSheet(true)}
          disabled={busy}
          testID={`${idPrefix}-pick`}
        />
        <Text variant="caption" tone={fieldError("file") ? "error" : "text2"}>
          {strings.receiptFieldFileHint}
        </Text>
      </View>

      {notice ? (
        <Text variant="caption" tone="error" accessibilityRole="alert">
          {notice === "camera" ? m("docs.cameraDenied") : m("docs.errorPick")}
        </Text>
      ) : null}
      {failed ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert" testID={`${idPrefix}-error`}>
          {strings[failed.error]}
        </Text>
      ) : null}
      {busy ? (
        <Text variant="secondary" tone="text2" accessibilityLiveRegion="polite" testID={`${idPrefix}-progress`}>
          {strings.receiptSubmitting} {state.status === "sending" && state.progress > 0 ? `${state.progress}%` : ""}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button label={busy ? strings.receiptSubmitting : strings.receiptSubmit} busy={busy} onPress={submit} testID={`${idPrefix}-submit`} />
        <Button variant="ghost" label={strings.receiptCancel} onPress={onCancel} disabled={busy} testID={`${idPrefix}-cancel`} />
      </View>

      <SourceSheet visible={sheet} title={strings.receiptFieldFile} onPick={onPick} onClose={() => setSheet(false)} onDismissed={flush} />
    </View>
  );
}
