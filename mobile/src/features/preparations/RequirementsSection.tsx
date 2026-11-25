// «Документы для этой программы»: заголовок с «Проверить состояние», заметки, состояние «список не открыт» и «нужно
// уточнить», список требований с файлами, неоконченные записи, история всех документов и ссылки внизу. Веб:
// `ApplicationRequirementsUI` (без блока комплекта, его добавляет следующий PR этого среза).
import type { ReactNode } from "react";
import { View } from "react-native";

import { studentDocumentPageHint } from "@web/lib/portal/application-documents-one-tap";
import type { ApplicationPackageReadiness } from "@web/lib/portal/application-packages";
import type { PortalStrings } from "@web/lib/portal/i18n";

import { usePreparation } from "@/features/preparations/context";
import { DocumentHistory } from "@/features/preparations/DocumentHistory";
import { DocumentRecovery } from "@/features/preparations/DocumentRecovery";
import { RequirementCard } from "@/features/preparations/RequirementCard";
import { requirementsNotes } from "@/features/preparations/model";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { CardHead, CardSkeleton, InlineAlert, LinkButton } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

export type RequirementsBusy = "read" | "initialize" | null;

function Notice({ children, testID }: { children: ReactNode; testID?: string }) {
  const { tokens } = useTheme();
  return (
    <View testID={testID} style={{ gap: 8, padding: 12, borderRadius: tokens.radiusItem, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }}>
      {children}
    </View>
  );
}

export function RequirementsSection({
  documents,
  loading,
  eligible,
  busy,
  error,
  staleNotice,
  loadingLabel,
  strings,
  onCheck,
  onInitialize,
  onOpenDocuments,
  onWrite,
}: {
  /** Последний полученный ответ сервера; `null`: ответа ещё не было (первое чтение не удалось). */
  documents: ApplicationPackageReadiness | null;
  /** Первое чтение ещё идёт. */
  loading: boolean;
  eligible: boolean;
  busy: RequirementsBusy;
  /** Готовый текст ошибки последнего нажатия или `null`. */
  error: string | null;
  /** Очередное чтение не удалось, а прежний ответ показан: пометка с повтором (`null`: чтение удалось). */
  staleNotice: Readonly<{ message: string; retryLabel: string }> | null;
  loadingLabel: string;
  strings: PortalStrings<"preparations">;
  onCheck: () => void;
  onInitialize: () => void;
  /** `null`: ссылки нет (в уровне доступа нет раздела «Документы»). */
  onOpenDocuments: (() => void) | null;
  /** `null`: ссылки нет (беседа с командой есть только при сопровождении). */
  onWrite: (() => void) | null;
}) {
  const { epoch, strings: documentStrings } = usePreparation();
  const current = documents?.requirements ?? null;
  const notes = requirementsNotes(current, eligible);
  // Подсказка под списком говорит «два шага» только если это верно для каждого документа, куда можно загружать.
  const pageHint = studentDocumentPageHint(documents?.documentItems);
  return (
    <View style={{ gap: 12 }} accessibilityState={{ busy: busy !== null }} testID="prep-requirements">
      <CardHead
        title={strings.requirements}
        action={<Button variant="ghost" label={busy === "read" ? strings.checking : strings.check} onPress={onCheck} disabled={busy !== null || loading} testID="prep-check" />}
      />
      {notes.starter ? (
        <Text variant="secondary" tone="text2" testID="prep-starter">
          {strings.starter}
        </Text>
      ) : null}
      {notes.confirmed ? (
        <Text variant="secondary" tone="text2" testID="prep-confirmed">
          {strings.confirmed}
        </Text>
      ) : null}
      {staleNotice ? <InlineAlert message={staleNotice.message} retryLabel={staleNotice.retryLabel} onRetry={onCheck} testID="prep-requirements-stale" /> : null}
      {loading ? <CardSkeleton label={loadingLabel} lines={3} testID="prep-requirements-loading" /> : null}
      {!loading && current === null ? <InlineAlert message={strings.requirementsUnavailable} testID="prep-requirements-error" /> : null}
      {current?.state === "uninitialized" ? (
        <Notice testID="prep-uninitialized">
          <Text variant="body">{eligible ? strings.uninitialized : strings.initializationIneligible}</Text>
          {eligible ? <Button label={busy === "initialize" ? strings.initializing : strings.continue} onPress={onInitialize} disabled={busy !== null} testID="prep-continue" /> : null}
        </Notice>
      ) : null}
      {current?.state === "needs_configuration" ? (
        <Notice testID="prep-needs-configuration">
          <Text variant="heading" accessibilityRole="header">
            {strings.needsConfiguration}
          </Text>
          <Text variant="body">{strings.configurationHelp}</Text>
          {current.configurationReasons.map((reason) => (
            <Text key={reason} variant="secondary">
              • {strings[`config.${reason}`]}
            </Text>
          ))}
        </Notice>
      ) : null}
      {current && current.revisionId && documents && current.items.length > 0 ? (
        <View style={{ gap: 12 }} accessibilityRole="list" testID="prep-requirement-list">
          {current.items.map((item, index) => {
            const state = documents.documentItems[index];
            return state ? <RequirementCard key={item.requirementItemId} item={item} state={state} revisionId={current.revisionId} strings={strings} /> : null;
          })}
        </View>
      ) : null}
      <DocumentRecovery currentItemIds={documents?.documentItems.map((item) => item.requirementItemId) ?? []} />
      <DocumentHistory key={epoch} requirementItemId={null} testID="prep-program-history" />
      {error ? <InlineAlert message={error} testID="prep-error" /> : null}
      {pageHint === "two_step" ? (
        <Text variant="secondary" tone="text2" testID="prep-page-hint">
          {documentStrings.saveHint}
        </Text>
      ) : null}
      {onOpenDocuments || onWrite ? (
        <View style={{ gap: 4 }}>
          {onOpenDocuments ? <Button variant="ghost" label={strings.allDocuments} onPress={onOpenDocuments} testID="prep-all-documents" /> : null}
          {onWrite ? <LinkButton label={strings.help} onPress={onWrite} testID="prep-write" /> : null}
        </View>
      ) : null}
    </View>
  );
}
