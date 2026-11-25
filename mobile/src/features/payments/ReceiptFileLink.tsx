// Ссылка на файл чека в строке платежа (веб: `a.pt-pay-file`): имя файла, нажатие скачивает его через case-files
// (Bearer только на портал, подписанный адрес без токена) и открывает системным просмотром.
import { useState } from "react";
import { Pressable, View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import { resolveMimeType } from "@/domain/documents-model";
import type { ReceiptFile } from "@/domain/payments-model";
import { downloadFile } from "@/features/documents/download";
import type { DocumentsIo } from "@/features/documents/io";
import type { MobileStringKey } from "@/i18n";
import { useLang } from "@/i18n/LangProvider";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

const FILE_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

export function ReceiptFileLink({ io, file, testID }: { io: DocumentsIo; file: ReceiptFile; testID: string }) {
  const { m, t, format } = useLang();
  const { tokens } = useTheme();
  const api = usePortalApi();
  const strings = t("admission");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await downloadFile(io.createDownloadDeps(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), { kind: "case-file", fileKind: file.fileKind, fileId: file.fileId }, file.filename, FILE_MIME_TYPES);
    if (result.ok) {
      try {
        await io.openLocalFile(result.uri, resolveMimeType({ name: result.name, mimeType: null }) ?? "application/pdf");
      } catch {
        setError("docs.downloadFailed");
      }
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  return (
    <View style={{ flexShrink: 1, gap: 2 }}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={format(strings.receiptOpenFileAria, { name: file.filename })}
        accessibilityState={{ busy }}
        disabled={busy}
        onPress={() => void open()}
        testID={testID}
        style={{ minHeight: MIN_TARGET, justifyContent: "center", flexShrink: 1 }}
      >
        <Text variant="secondary" style={{ color: tokens.accent, textDecorationLine: "underline", fontFamily: sansFont("medium") }}>
          {busy ? m("docs.downloading") : file.filename}
        </Text>
      </Pressable>
      {error ? (
        <Text variant="caption" tone="error" accessibilityRole="alert" testID={`${testID}-error`}>
          {error.startsWith("docs.") ? m(error as MobileStringKey) : strings.errorUnavailable}
        </Text>
      ) : null}
    </View>
  );
}
