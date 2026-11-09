// «Договор и чеки»: свои файлы дела, только чтение (веб: CaseFilesCard.tsx, миграция 352).
// Скачивание: bearer-маршрут /api/portal/case-files/{вид}/{id}/download. Нет файлов: блока нет.
import { FileText } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

import { usePortalApi } from "@/api/PortalApi";
import type { StudentPortalCaseFile } from "@/domain/portal-source";
import { formatPortalTimestamp } from "@/domain/presentation";
import { downloadFile, type DownloadErrorKey } from "@/features/documents/download";
import type { DocumentsIo } from "@/features/documents/io";
import { useLang } from "@/i18n/LangProvider";
import type { MobileStringKey } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardHead } from "@/ui/CardParts";
import { Card } from "@/ui/Screen";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

function CaseFileRow({ file, io, first }: { file: StudentPortalCaseFile; io: DocumentsIo; first: boolean }) {
  const { m, t, format } = useLang();
  const { tokens } = useTheme();
  const api = usePortalApi();
  const strings = t("admission");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DownloadErrorKey | null>(null);
  const added = formatPortalTimestamp(file.addedAt);
  const title = file.kind === "contract" ? strings.caseFileContract : strings.caseFileReceipt;

  const open = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await downloadFile(io.createDownloadDeps(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), { kind: "case-file", fileKind: file.kind, fileId: file.fileId }, file.originalFilename, file.declaredMimeType);
    if (result.ok) {
      try {
        await io.openLocalFile(result.uri, file.declaredMimeType);
      } catch {
        setError("docs.downloadFailed");
      }
    } else {
      setError(result.error);
    }
    setBusy(false);
  };

  return (
    <View testID={`case-file-${file.kind}-${file.fileId}`} style={{ flexDirection: "row", gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.line }}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: tokens.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <FileText size={18} strokeWidth={1.75} color={tokens.accent} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text variant="body" bold>
          {title}
        </Text>
        <Text variant="caption" tone="text2">
          {file.originalFilename}
          {added ? ` · ${added}` : ""}
        </Text>
        {file.kind === "contract" ? null : <StatusPill label={file.kind === "receipt" ? strings.caseFileReceiptAttached : strings.caseFileReceiptPending} tone={file.kind === "receipt" ? "ok" : "neutral"} />}
        {error ? (
          <Text variant="caption" tone="error" accessibilityRole="alert">
            {error.startsWith("docs.") ? m(error as MobileStringKey) : (strings as Record<string, string>)[error] ?? strings.errorUnavailable}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", marginTop: 2 }}>
          <Button variant="ghost" label={busy ? m("docs.downloading") : strings.downloadButton} accessibilityLabel={format(strings.downloadAria, { name: file.originalFilename })} busy={busy} onPress={() => void open()} testID={`case-file-download-${file.kind}-${file.fileId}`} />
        </View>
      </View>
    </View>
  );
}

export function CaseFilesCard({ files, io }: { files: readonly StudentPortalCaseFile[]; io: DocumentsIo }) {
  const { t } = useLang();
  const strings = t("admission");
  if (files.length === 0) return null;
  return (
    <Card>
      <View testID="case-files">
        <CardHead title={strings.caseFilesTitle} />
        <Text variant="secondary" tone="text2" style={{ marginTop: 4, marginBottom: 8 }}>
          {strings.caseFilesLead}
        </Text>
        {files.map((file, index) => (
          <CaseFileRow key={`${file.kind}:${file.fileId}`} file={file} io={io} first={index === 0} />
        ))}
      </View>
    </Card>
  );
}
