// Строка истории платежа или чека без платежа: дата, сумма, статус, причина отказа, «Открыть чек», «Приложить снова».
import { useState } from "react";
import { View } from "react-native";
import type { PaymentEntry } from "@web/lib/portal/payment-center";

import { usePortalApi } from "@/api/PortalApi";
import { resolveMimeType } from "@/domain/documents-model";
import { entryKindLabel, entryStatusPresentation, formatEntryDay } from "@/domain/payments-model";
import { formatPortalMoney } from "@/domain/presentation";
import { downloadFile } from "@/features/documents/download";
import type { DocumentsIo } from "@/features/documents/io";
import type { MobileStringKey } from "@/i18n";
import { useLang } from "@/i18n/LangProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

const FILE_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

export function EntryRow({ entry, io, testID, first, onAttachAgain }: { entry: PaymentEntry; io: DocumentsIo; testID: string; first: boolean; onAttachAgain?: (() => void) | null }) {
  const { m, t, format } = useLang();
  const { tokens } = useTheme();
  const api = usePortalApi();
  const strings = t("admission");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = entryStatusPresentation(entry, strings);

  const open = async () => {
    if (busy || !entry.fileId || !entry.fileKind) return;
    setBusy(true);
    setError(null);
    const result = await downloadFile(io.createDownloadDeps(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), { kind: "case-file", fileKind: entry.fileKind, fileId: entry.fileId }, entry.filename ?? "receipt", FILE_MIME_TYPES);
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
    <View testID={testID} style={{ gap: 6, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.line }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 6 }}>
        <Text variant="data" bold testID={`${testID}-amount`}>
          {formatPortalMoney(entry.amountMinor, entry.currency)}
        </Text>
        <Text variant="caption" tone="text2">
          {entryKindLabel(entry, strings)} · {formatEntryDay(entry.onDate)}
        </Text>
        <StatusPill label={status.label} tone={status.tone} testID={`${testID}-status`} />
      </View>
      {entry.rejectReason ? (
        <Text variant="secondary" testID={`${testID}-reason`}>
          <Text variant="secondary" bold>
            {strings.receiptReasonLabel}
          </Text>{" "}
          {entry.rejectReason}
        </Text>
      ) : null}
      {error ? (
        <Text variant="caption" tone="error" accessibilityRole="alert">
          {error.startsWith("docs.") ? m(error as MobileStringKey) : strings.errorUnavailable}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {entry.fileId ? (
          <Button
            variant="ghost"
            label={busy ? m("docs.downloading") : strings.receiptOpenFile}
            accessibilityLabel={format(strings.receiptOpenFileAria, { name: entry.filename ?? "" })}
            busy={busy}
            onPress={() => void open()}
            testID={`${testID}-open`}
          />
        ) : null}
        {entry.status === "rejected" && onAttachAgain ? <Button variant="ghost" label={strings.receiptAttachAgain} onPress={onAttachAgain} testID={`${testID}-again`} /> : null}
      </View>
    </View>
  );
}
