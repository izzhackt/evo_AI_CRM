// «Как оплатить»: поля из текста реквизитов (банк, получатель, телефон) и «Сумма к оплате» с кнопками «Скопировать»,
// остальной текст как есть, крупный QR. Образец: HowToPayCard.tsx (веб, #1476). Блока нет, пока реквизитов нет.
// QR качается один раз тем же путём, что файлы дела (Bearer только на портал, подписанный адрес без токена),
// и рисуется из локального файла кэша. «Скачать QR» отдаёт файл системному меню (сохранить в «Фото» / «Файлы»),
// «На весь экран» открывает QR на белом фоне, чтобы его считал банковский сканер.
import { Image } from "expo-image";
import { Check, Copy, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, useWindowDimensions, View } from "react-native";
import type { PaymentDetails } from "@web/lib/portal/payment-center";
import { parseHowToPayText, type HowToPayAmount, type HowToPayFieldKey } from "@web/lib/portal/how-to-pay";

import { usePortalApi } from "@/api/PortalApi";
import { resolveMimeType } from "@/domain/documents-model";
import { downloadFile } from "@/features/documents/download";
import type { PaymentsIo } from "@/features/payments/io";
import type { MobileStringKey } from "@/i18n";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardHead, LinkButton, MIN_TARGET } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const QR_MIME_TYPES = ["image/png", "image/jpeg"] as const;

type QrState = Readonly<{ status: "loading" }> | Readonly<{ status: "ready"; uri: string }> | Readonly<{ status: "error"; error: string }>;
type FieldKey = HowToPayFieldKey | "amount";
type Feedback = Readonly<{ key: FieldKey; ok: boolean }>;

const COPY_LABEL = { bank: "howToPayCopyBank", recipient: "howToPayCopyRecipient", phone: "howToPayCopyPhone", amount: "howToPayCopyAmount" } as const;
const FIELD_LABEL = { bank: "howToPayBankLabel", recipient: "howToPayRecipientLabel", phone: "howToPayPhoneLabel", amount: "howToPayAmountLabel" } as const;

export function HowToPayCard({ details, amount = null, io }: { details: PaymentDetails; amount?: HowToPayAmount | null; io: PaymentsIo }) {
  const { m, t, format } = useLang();
  const { tokens } = useTheme();
  const api = usePortalApi();
  const { width } = useWindowDimensions();
  const strings = t("admission");
  const parsed = parseHowToPayText(details.text);
  const qrId = details.hasQr ? details.qrId : null;
  const [qr, setQr] = useState<QrState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [full, setFull] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!qrId) return;
    let alive = true;
    void downloadFile(io.createDownloadDeps(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), { kind: "case-file", fileKind: "payment_details_qr", fileId: qrId }, "payment-qr", QR_MIME_TYPES).then((result) => {
      if (alive) setQr(result.ok ? { status: "ready", uri: result.uri } : { status: "error", error: result.error });
    });
    return () => {
      alive = false;
    };
    // Адрес и токены приходят из контекста; другая версия QR - другой ключ карточки (новое монтирование), «Повторить» - attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrId, attempt]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const retry = useCallback(() => {
    setQr({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  const copy = async (key: FieldKey, value: string) => {
    const ok = await io.copyText(value);
    setFeedback({ key, ok });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setFeedback(null);
    }, 2000);
  };

  const saveQr = async () => {
    if (qr.status !== "ready") return;
    setSaveError(false);
    try {
      await io.openLocalFile(qr.uri, resolveMimeType({ name: qr.uri, mimeType: null }) ?? "image/png");
    } catch {
      setSaveError(true);
    }
  };

  const dueText = amount?.dueOn ? format(amount.overdue ? strings.howToPayAmountOverdue : strings.howToPayAmountDue, { date: amount.dueOn }) : null;
  const rows: { key: FieldKey; value: string; copyValue: string; due: string | null }[] = [
    ...parsed.fields.map((item) => ({ key: item.key as FieldKey, value: item.value, copyValue: item.copyValue, due: null })),
    ...(amount ? [{ key: "amount" as const, value: amount.display, copyValue: amount.copyValue, due: dueText }] : []),
  ];
  const qrSize = Math.min(320, Math.max(220, width - 32 - 32 - 16));
  const fullSize = Math.min(560, width - 32);

  return (
    <Card>
      <View testID="how-to-pay" style={{ gap: 12 }}>
        <CardHead title={strings.howToPayTitle} />
        {rows.map((row) => {
          const mine = feedback?.key === row.key ? feedback : null;
          const copyLabel = strings[COPY_LABEL[row.key]];
          return (
            <View key={row.key} testID={`how-to-pay-${row.key}`} style={{ gap: 2 }}>
              <Text variant="caption" tone="text2">
                {strings[FIELD_LABEL[row.key]]}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text variant="body" bold selectable style={{ flexShrink: 1 }} testID={`how-to-pay-${row.key}-value`}>
                  {row.value}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copyLabel}
                  onPress={() => void copy(row.key, row.copyValue)}
                  hitSlop={4}
                  testID={`how-to-pay-${row.key}-copy`}
                  style={({ pressed }) => ({ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center", borderRadius: tokens.radiusControl, backgroundColor: pressed ? tokens.accentSoft : "transparent" })}
                >
                  {mine?.ok ? <Check size={18} strokeWidth={1.8} color={tokens.ok} /> : <Copy size={18} strokeWidth={1.8} color={tokens.accent} />}
                </Pressable>
              </View>
              {mine ? (
                <Text variant="caption" tone={mine.ok ? "ok" : "error"} accessibilityLiveRegion="polite" accessibilityRole={mine.ok ? undefined : "alert"} testID={`how-to-pay-${row.key}-feedback`}>
                  {mine.ok ? strings.howToPayCopied : strings.howToPayCopyFailed}
                </Text>
              ) : null}
              {row.due ? (
                <Text variant="caption" tone="text2">
                  {row.due}
                </Text>
              ) : null}
            </View>
          );
        })}
        {parsed.rest ? (
          <Text variant="body" selectable testID="how-to-pay-text">
            {parsed.rest}
          </Text>
        ) : null}
        {qrId ? (
          qr.status === "ready" ? (
            <View style={{ gap: 8, alignItems: "flex-start" }}>
              <View style={{ alignSelf: "flex-start", padding: 8, gap: 6, borderRadius: tokens.radiusControl, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: tokens.line }}>
                {parsed.brand ? (
                  <Text variant="caption" bold style={{ color: "#1A1A1A", textAlign: "center" }} testID="how-to-pay-qr-brand">
                    {parsed.brand}
                  </Text>
                ) : null}
                <Image source={{ uri: qr.uri }} accessibilityLabel={strings.howToPayQrAlt} contentFit="contain" style={{ width: qrSize, height: qrSize }} testID="how-to-pay-qr" />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Button variant="ghost" label={strings.howToPayDownload} onPress={() => void saveQr()} testID="how-to-pay-qr-download" />
                <Button variant="ghost" label={strings.howToPayFullscreen} onPress={() => setFull(true)} testID="how-to-pay-qr-full" />
              </View>
              {saveError ? (
                <Text variant="caption" tone="error" accessibilityRole="alert" testID="how-to-pay-qr-save-error">
                  {m("docs.downloadFailed")}
                </Text>
              ) : null}
            </View>
          ) : qr.status === "error" ? (
            <View style={{ gap: 4 }} testID="how-to-pay-qr-error">
              <Text variant="caption" tone="error" accessibilityRole="alert">
                {qr.error.startsWith("docs.") ? m(qr.error as MobileStringKey) : strings.errorUnavailable}
              </Text>
              <View style={{ flexDirection: "row" }}>
                <LinkButton label={m("gate.retry")} onPress={retry} testID="how-to-pay-qr-retry" />
              </View>
            </View>
          ) : (
            <Text variant="caption" tone="text2" accessibilityLiveRegion="polite">
              {m("state.loading")}
            </Text>
          )
        ) : null}
        <Text variant="secondary" tone="text2">
          {strings.howToPayQrNote}
        </Text>
      </View>
      {qr.status === "ready" ? (
        <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)} statusBarTranslucent>
          <View testID="how-to-pay-qr-dialog" accessibilityViewIsModal style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <View style={{ width: fullSize + 32, maxWidth: "100%", padding: 16, gap: 12, borderRadius: tokens.radiusControl, backgroundColor: "#FFFFFF" }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Text variant="heading" accessibilityRole="header" style={{ color: "#1A1A1A", flexShrink: 1 }}>
                  {parsed.brand ?? strings.howToPayQrAlt}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel={strings.howToPayClose} onPress={() => setFull(false)} testID="how-to-pay-qr-close" style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
                  <X size={22} strokeWidth={1.8} color="#1A1A1A" />
                </Pressable>
              </View>
              <Image source={{ uri: qr.uri }} accessibilityLabel={parsed.brand ? strings.howToPayQrAlt : undefined} contentFit="contain" style={{ width: fullSize, height: fullSize }} testID="how-to-pay-qr-large" />
            </View>
          </View>
        </Modal>
      ) : null}
    </Card>
  );
}
