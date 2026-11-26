// Строка чек-листа: что за документ, статус, замечание проверяющего и действия.
// Образец: DocumentsView.tsx + PortalDocumentControls.tsx (веб). Один вход загрузки
// на строку (#1361): «Загрузить» / «Заменить» открывает лист «файл, фото, камера».
import { randomUUID } from "expo-crypto";
import { AlertTriangle, Check, Clock, FileText } from "lucide-react-native";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Linking, Platform, View } from "react-native";
import { defaultDocumentHint } from "@web/lib/portal/document-hints";

import { usePortalApi } from "@/api/PortalApi";
import { useInvalidateAfterUpload } from "@/api/queries";
import { documentChecklistIcon, documentReviewText, documentStatusLabel, documentStatusTone, type PickSource } from "@/domain/documents-model";
import type { StudentPortalDocument } from "@/domain/portal-source";
import { formatPortalDeadline, formatPortalTimestamp } from "@/domain/presentation";
import { DocumentGuideButton, guideFor, type GuideAction } from "@/features/documents/DocumentGuide";
import { downloadFile, type DownloadErrorKey } from "@/features/documents/download";
import type { DocumentsIo } from "@/features/documents/io";
import { SourceSheet } from "@/features/documents/SourceSheet";
import { UploadController, type UploadErrorKey } from "@/features/documents/upload-controller";
import { useLang } from "@/i18n/LangProvider";
import type { MobileStringKey } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { LinkButton } from "@/ui/CardParts";
import { StatusPill } from "@/ui/StatusPill";
import { Text } from "@/ui/Text";

const ICONS = { file: FileText, clock: Clock, check: Check, alert: AlertTriangle } as const;

type Notice = Readonly<{ kind: "camera"; canAskAgain: boolean }> | Readonly<{ kind: "pick" }> | Readonly<{ kind: "download"; error: DownloadErrorKey }> | null;

function fileLabelFor(document: StudentPortalDocument, fallback: string): string {
  return document.originalFilename ?? fallback;
}

export function DocumentRow({ document, io, country = null, first = false, highlighted = false }: { document: StudentPortalDocument; io: DocumentsIo; /** Страна дела строки: по ней справка «Пример» берёт образцы страны. */ country?: string | null; first?: boolean; highlighted?: boolean }) {
  const { lang, m, t, format } = useLang();
  const { tokens } = useTheme();
  const api = usePortalApi();
  const invalidate = useInvalidateAfterUpload();
  const strings = t("admission");
  const [controller] = useState(() => new UploadController(document.documentSlotId, io.createUploadSend(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), randomUUID, invalidate));
  const upload = useSyncExternalStore(controller.subscribe, controller.getState);
  const [sheet, setSheet] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [downloading, setDownloading] = useState(false);
  const pending = useRef<PickSource | null>(null);

  const busy = upload.status === "uploading" || upload.status === "confirming";
  const status = documentStatusLabel(document.status, strings);
  const Icon = ICONS[documentChecklistIcon(document.status)];
  // Общая подсказка уходит в справку «Пример», если справка есть (веб: DocumentsView.tsx). Своя инструкция куратора остаётся в строке.
  const guide = guideFor(document.requirementLabel, document.requirementKey, lang, country);
  const hint = document.instructions ?? (guide ? null : defaultDocumentHint(document.requirementLabel, lang));
  const deadline = formatPortalDeadline(document.deadline);
  const submitted = formatPortalTimestamp(document.submittedAt);
  const review = documentReviewText(document, strings);
  const text = (key: UploadErrorKey | DownloadErrorKey): string => (key.startsWith("docs.") ? m(key as MobileStringKey) : (strings as Record<string, string>)[key] ?? strings.errorUnavailable);

  const runPick = useCallback(
    async (source: PickSource) => {
      setNotice(null);
      const outcome = await io.pick(source);
      if (outcome.kind === "picked") controller.select(outcome.file);
      else if (outcome.kind === "denied") setNotice({ kind: "camera", canAskAgain: outcome.canAskAgain });
      else if (outcome.kind === "failed") setNotice({ kind: "pick" });
    },
    [io, controller],
  );
  // iOS не показывает системный выбор, пока закрывается лист: ждём onDismiss (запасной таймер на случай, если он не пришёл).
  const flush = useCallback(() => {
    const source = pending.current;
    pending.current = null;
    if (source) void runPick(source);
  }, [runPick]);
  const onPick = (source: PickSource) => {
    pending.current = source;
    setSheet(false);
    if (Platform.OS === "ios") setTimeout(flush, 700);
    else flush();
  };

  const onDownload = async () => {
    if (!document.documentVersionId || downloading) return;
    setDownloading(true);
    setNotice(null);
    const mime = document.declaredMimeType ?? "application/pdf";
    const result = await downloadFile(io.createDownloadDeps(api.portalBaseUrl, api.getAccessToken, api.refreshAccessToken), { kind: "version", versionId: document.documentVersionId }, document.originalFilename ?? "document", mime);
    if (result.ok) {
      try {
        await io.openLocalFile(result.uri, mime);
      } catch {
        setNotice({ kind: "download", error: "docs.downloadFailed" });
      }
    } else {
      setNotice({ kind: "download", error: result.error });
    }
    setDownloading(false);
  };

  // Принятый документ заменить нельзя: в листе «Пример» у него «Скачать», у остальных «Загрузить» / «Заменить».
  const guideAction: GuideAction | null =
    document.status === "approved"
      ? document.documentVersionId
        ? { label: strings.downloadButton, accessibilityLabel: format(strings.downloadAria, { name: fileLabelFor(document, strings.lastFileFallback) }), onPress: () => void onDownload(), testID: `guide-download-${document.documentSlotId}`, kind: "download" as const }
        : null
      : busy
        ? null
        : { label: document.documentVersionId ? strings.replaceButton : strings.uploadButton, onPress: () => setSheet(true), testID: `guide-upload-${document.documentSlotId}` };

  const feedback =
    upload.status === "uploading"
      ? format(m("docs.progress"), { percent: String(upload.progress) })
      : upload.status === "confirming"
        ? strings.uploadConfirming
        : upload.status === "success"
          ? format(strings.uploadSuccess, { name: upload.fileName })
          : upload.status === "cancelled"
            ? m("docs.uploadCancelled")
            : upload.status === "error"
              ? text(upload.error)
              : notice?.kind === "camera"
                ? m("docs.cameraDenied")
                : notice?.kind === "pick"
                  ? m("docs.errorPick")
                  : notice?.kind === "download"
                    ? text(notice.error)
                    : null;
  const feedbackIsError = upload.status === "error" || (upload.status === "idle" && notice !== null);
  const fileLabel = document.originalFilename ?? strings.lastFileFallback;

  return (
    <View
      testID={`document-${document.documentSlotId}`}
      style={{ flexDirection: "row", gap: 12, paddingVertical: 14, paddingHorizontal: 4, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.line, backgroundColor: highlighted ? tokens.accentSoft : "transparent" }}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: tokens.accentSoft, alignItems: "center", justifyContent: "center" }}>
        <Icon size={18} strokeWidth={1.75} color={tokens.accent} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text variant="body" bold accessibilityRole="header">
          {document.requirementLabel}
        </Text>
        {/* Как на веб-телефоне: статус и «Пример» одной строкой под названием, длинное название не сжимает кнопку. */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <StatusPill label={status} tone={documentStatusTone(document.status)} testID={`status-${document.documentSlotId}`} />
          <DocumentGuideButton label={document.requirementLabel} requirementKey={document.requirementKey} country={country} statusLabel={status} statusTone={documentStatusTone(document.status)} action={guideAction} io={io} testID={`guide-${document.documentSlotId}`} />
        </View>
        {hint ? (
          <Text variant="secondary" tone="text2">
            {hint}
          </Text>
        ) : null}
        {document.originalFilename ? (
          <Text variant="caption" tone="text2">
            {document.originalFilename}
            {submitted ? ` · ${submitted}` : ""}
          </Text>
        ) : null}
        {deadline ? (
          <Text variant="caption" tone="text2">
            {strings.deadlineTerm} {deadline}
          </Text>
        ) : null}
        {review ? (
          <Text variant="caption" tone="text2">
            {strings.decisionTerm} {review}
          </Text>
        ) : null}
        {document.reworkReason ? (
          <View accessibilityLabel={strings.reworkTitle} style={{ gap: 2, padding: 10, borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: tokens.warn }}>
            <Text variant="caption" bold style={{ color: tokens.warn }}>
              {strings.reworkTitle}
            </Text>
            <Text variant="secondary">{document.reworkReason}</Text>
          </View>
        ) : null}
        {document.nextAction ? (
          <Text variant="secondary">
            <Text variant="secondary" bold>
              {strings.nextStepLabel}
            </Text>{" "}
            {document.nextAction}
          </Text>
        ) : null}

        {busy ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel={strings.uploadingButton} accessibilityValue={upload.status === "uploading" ? { min: 0, max: 100, now: upload.progress } : undefined} style={{ height: 6, borderRadius: 3, backgroundColor: tokens.skeleton, overflow: "hidden" }}>
            <View style={{ width: `${upload.status === "uploading" ? upload.progress : 100}%`, height: 6, backgroundColor: tokens.accent }} />
          </View>
        ) : null}
        {feedback ? (
          <Text variant="caption" accessibilityRole={feedbackIsError ? "alert" : undefined} accessibilityLiveRegion="polite" tone={feedbackIsError ? "error" : upload.status === "success" ? "ok" : "text2"} testID={`feedback-${document.documentSlotId}`}>
            {feedback}
          </Text>
        ) : null}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4 }}>
          {document.status === "approved" ? (
            <Text variant="caption" tone="text2" style={{ flexShrink: 1 }}>
              {strings.uploadLocked}
            </Text>
          ) : busy ? (
            <Button variant="ghost" label={m("docs.cancelUpload")} onPress={() => controller.cancel()} testID={`cancel-${document.documentSlotId}`} />
          ) : (
            <Button
              variant={document.status === "required" || document.status === "correction_required" || document.status === "rejected" ? "primary" : "ghost"}
              label={document.documentVersionId ? strings.replaceButton : strings.uploadButton}
              onPress={() => setSheet(true)}
              testID={`upload-${document.documentSlotId}`}
            />
          )}
          {upload.status === "error" && upload.retryable ? <Button variant="ghost" label={strings.retryUploadButton} onPress={() => controller.retry()} testID={`retry-${document.documentSlotId}`} /> : null}
          {upload.status === "cancelled" ? <Button variant="ghost" label={m("docs.resumeUpload")} onPress={() => controller.retry()} testID={`resume-${document.documentSlotId}`} /> : null}
          {notice?.kind === "camera" && !notice.canAskAgain ? <LinkButton label={m("docs.openSettings")} onPress={() => void Linking.openSettings()} testID={`settings-${document.documentSlotId}`} /> : null}
          {document.documentVersionId ? (
            <Button variant="ghost" label={downloading ? m("docs.downloading") : strings.downloadButton} accessibilityLabel={format(strings.downloadAria, { name: fileLabel })} busy={downloading} onPress={() => void onDownload()} testID={`download-${document.documentSlotId}`} />
          ) : null}
        </View>
      </View>
      <SourceSheet visible={sheet} title={document.requirementLabel} onPick={onPick} onClose={() => setSheet(false)} onDismissed={flush} />
    </View>
  );
}
