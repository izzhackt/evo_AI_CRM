// «Как оплатить»: текст реквизитов и QR из единого чтения оплаты. Блока нет, пока реквизитов нет.
// QR качается один раз тем же путём, что файлы дела (Bearer только на портал, подписанный адрес без токена),
// и рисуется из локального файла кэша.
import { Image } from "expo-image";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import type { PaymentDetails } from "@web/lib/portal/payment-center";

import { usePortalApi } from "@/api/PortalApi";
import { downloadFile } from "@/features/documents/download";
import type { DocumentsIo } from "@/features/documents/io";
import type { MobileStringKey } from "@/i18n";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { CardHead, LinkButton } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { Text } from "@/ui/Text";

const QR_MIME_TYPES = ["image/png", "image/jpeg"] as const;

type QrState = Readonly<{ status: "loading" }> | Readonly<{ status: "ready"; uri: string }> | Readonly<{ status: "error"; error: string }>;

export function HowToPayCard({ details, io }: { details: PaymentDetails; io: DocumentsIo }) {
  const { m, t } = useLang();
  const { tokens } = useTheme();
  const api = usePortalApi();
  const strings = t("admission");
  const qrId = details.hasQr ? details.qrId : null;
  const [qr, setQr] = useState<QrState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

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
  const retry = useCallback(() => {
    setQr({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  return (
    <Card>
      <View testID="how-to-pay" style={{ gap: 12 }}>
        <CardHead title={strings.howToPayTitle} />
        <Text variant="body" selectable testID="how-to-pay-text">
          {details.text}
        </Text>
        {qrId ? (
          qr.status === "ready" ? (
            <View style={{ alignSelf: "flex-start", padding: 8, borderRadius: tokens.radiusControl, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: tokens.line }}>
              <Image source={{ uri: qr.uri }} accessibilityLabel={strings.howToPayQrAlt} contentFit="contain" style={{ width: 220, height: 220 }} testID="how-to-pay-qr" />
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
    </Card>
  );
}
