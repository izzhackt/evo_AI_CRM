// «Приложить чек» у принятой оплаты без файла (веб: ProofSlot в PaymentReceiptForm.tsx, #1458, миграция 360).
// Только файл: сумма, дата и статус не меняются, куратор ничего не проверяет. Выбор файла - лист «файл, фото, камера».
import { randomUUID } from "expo-crypto";
import { X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform, Pressable, View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { useInvalidatePaymentCenter } from "@/api/queries";
import type { PickedFile, PickSource } from "@/domain/documents-model";
import { SourceSheet } from "@/features/documents/SourceSheet";
import type { PaymentsIo } from "@/features/payments/io";
import { ProofUploadController } from "@/features/payments/proof-upload";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

type Notice = "camera" | "pick" | null;

export function ProofSlot({ io, paymentEventId, context, testID }: { io: PaymentsIo; paymentEventId: string; context: string; testID: string }) {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const api = usePortalApi();
  const invalidate = useInvalidatePaymentCenter();
  const strings = t("admission");
  const [controller] = useState(() => new ProofUploadController(io.createProofSend(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), randomUUID, invalidate));
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
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

  if (state.status === "success") {
    return (
      <Text variant="secondary" tone="ok" bold accessibilityRole="alert" accessibilityLiveRegion="polite" testID={`${testID}-sent`}>
        {strings.proofAttached}
      </Text>
    );
  }

  const busy = state.status === "sending";
  const failed = state.status === "error" ? state : null;
  const errorText = failed ? ((strings as Record<string, string>)[failed.error] ?? strings.receiptErrorUnavailable) : null;
  const problem = notice === "camera" ? m("docs.cameraDenied") : notice === "pick" ? m("docs.errorPick") : errorText;

  return (
    <View style={{ gap: 6 }} testID={testID}>
      {file ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text variant="secondary" numberOfLines={1} style={{ flexShrink: 1 }} testID={`${testID}-file`}>
              {file.name}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={strings.receiptClearFile}
              disabled={busy}
              onPress={() => {
                setFile(null);
                controller.clearMessage();
              }}
              hitSlop={8}
              testID={`${testID}-clear`}
              style={{ minWidth: MIN_TARGET, minHeight: MIN_TARGET, alignItems: "center", justifyContent: "center" }}
            >
              <X size={16} strokeWidth={1.75} color={tokens.text2} />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row" }}>
            <Button label={busy ? strings.receiptSaving : strings.receiptSave} busy={busy} onPress={() => controller.submit(paymentEventId, file)} testID={`${testID}-save`} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row" }}>
          <Button variant="ghost" label={`+ ${strings.receiptAttach}`} accessibilityLabel={`${strings.receiptAttach}: ${context}`} onPress={() => setSheet(true)} disabled={busy} testID={`${testID}-attach`} />
        </View>
      )}
      {busy ? (
        <Text variant="caption" tone="text2" accessibilityLiveRegion="polite">
          {strings.receiptSaving} {state.status === "sending" && state.progress > 0 ? `${state.progress}%` : ""}
        </Text>
      ) : null}
      {problem ? (
        <Text variant="caption" tone="error" accessibilityRole="alert" testID={`${testID}-error`}>
          {problem}
        </Text>
      ) : null}
      <SourceSheet visible={sheet} title={strings.receiptAttach} onPick={onPick} onClose={() => setSheet(false)} onDismissed={flush} />
    </View>
  );
}
