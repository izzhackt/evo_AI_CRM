// «Использовать сохранённый файл»: выбор среди прежних версий файла требования (`application_document_reusable_versions_v1`),
// «Показать ещё» по страницам. Веб: блок `otherFile` в `ProgramDocumentItem.tsx` (там `<select>`, здесь список вариантов).
import { Check } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import type {
  ApplicationDocumentItemState,
  ApplicationDocumentItemTarget,
  ApplicationDocumentReusableVersion,
  ApplicationDocumentVersionCursor,
} from "@web/lib/portal/application-documents";

import { formatPortalString } from "@web/lib/portal/i18n";

import { usePortalApi } from "@/api/PortalApi";
import { readReusableVersions } from "@/api/preparations-documents";
import { Collapsible } from "@/features/preparations/Collapsible";
import { usePreparation } from "@/features/preparations/context";
import { FileFacts } from "@/features/preparations/ItemDocumentState";
import { availabilityText } from "@/features/preparations/model";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

/** Загруженные страницы сохранённых версий: первая из ответа программы, следующие по курсору. Одинаковые версии не повторяются. */
export function useSavedVersions(state: Pick<ApplicationDocumentItemState, "reusableVersions" | "reusableVersionsNextCursor">, target: ApplicationDocumentItemTarget) {
  const { transport } = usePortalApi();
  const { strings } = usePreparation();
  const [versions, setVersions] = useState<readonly ApplicationDocumentReusableVersion[]>(state.reusableVersions);
  const [cursor, setCursor] = useState<ApplicationDocumentVersionCursor | null>(state.reusableVersionsNextCursor);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const more = useCallback(async () => {
    if (lock.current || !cursor) return;
    lock.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const page = await readReusableVersions(transport, { studentCaseId: target.studentCaseId, applicationId: target.applicationId, requirementItemId: target.requirementItemId }, cursor);
      setVersions((current) => [...current, ...page.versions.filter((value) => !current.some((previous) => previous.file.documentVersionId === value.file.documentVersionId))]);
      setCursor(page.nextCursor);
    } catch {
      setFailed(true);
      // Текст ошибки стоит под списком с ролью «alert», а на iPhone она без объявления молчит.
      announce(strings.historyUnavailable);
    } finally {
      lock.current = false;
      setLoading(false);
    }
  }, [cursor, transport, strings.historyUnavailable, target.studentCaseId, target.applicationId, target.requirementItemId]);
  return { versions, cursor, loading, failed, more };
}

function VersionRow({ version, selected, onPress, testID }: { version: ApplicationDocumentReusableVersion; selected: boolean; onPress: () => void; testID: string }) {
  const { tokens } = useTheme();
  const { strings } = usePreparation();
  const available = version.file.technicalAvailability === "available";
  const versionLabel = formatPortalString(strings.version, { version: version.file.versionNo });
  // Недоступную версию выбрать нельзя; читалка слышит и причину («Файл проходит проверку безопасности»).
  const reasons = available ? [] : version.file.unavailableReasons.map((reason) => availabilityText(strings, reason));
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={[version.file.originalFilename, versionLabel, ...reasons].join(". ")}
      accessibilityState={{ selected, disabled: !available }}
      disabled={!available}
      onPress={onPress}
      testID={testID}
      style={{
        minHeight: MIN_TARGET + 4,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: tokens.radiusItem,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? tokens.accent : tokens.controlEdge,
        backgroundColor: tokens.surface,
        opacity: available ? 1 : 0.6,
      }}
    >
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text variant="body" bold={selected}>
          {version.file.originalFilename}
        </Text>
        <Text variant="caption" tone="text2">
          {versionLabel}
        </Text>
        {reasons.map((reason) => (
          <Text key={reason} variant="caption" tone="text2">
            {reason}
          </Text>
        ))}
      </View>
      {selected ? <Check size={18} strokeWidth={2} color={tokens.accent} /> : null}
    </Pressable>
  );
}

export function SavedVersions({ target, versions, cursor, loading, failed, onMore, selected, onSelect }: {
  target: ApplicationDocumentItemTarget;
  /** Версии, которые можно выбрать (текущая отправленная уже исключена). */
  versions: readonly ApplicationDocumentReusableVersion[];
  cursor: ApplicationDocumentVersionCursor | null;
  loading: boolean;
  failed: boolean;
  onMore: () => void;
  selected: string | null;
  onSelect: (documentVersionId: string | null) => void;
}) {
  const { strings } = usePreparation();
  const chosen = selected ? versions.find((version) => version.file.documentVersionId === selected) ?? null : null;
  return (
    <Collapsible title={strings.otherFile} testID={`prep-versions-${target.requirementItemId}`}>
      <Text variant="secondary" tone="text2">
        {strings.chooseVersion}
      </Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={strings.chooseVersion} style={{ gap: 8 }}>
        {versions.map((version) => (
          <VersionRow
            key={version.file.documentVersionId}
            version={version}
            selected={version.file.documentVersionId === selected}
            onPress={() => onSelect(version.file.documentVersionId === selected ? null : version.file.documentVersionId)}
            testID={`prep-version-${version.file.documentVersionId}`}
          />
        ))}
      </View>
      {chosen ? <FileFacts file={chosen.file} strings={strings} target={target} testID={`prep-version-chosen-${target.requirementItemId}`} /> : null}
      {cursor ? <Button variant="ghost" label={loading ? strings.loading : strings.historyMore} onPress={onMore} disabled={loading} testID={`prep-versions-more-${target.requirementItemId}`} /> : null}
      {failed ? (
        <Text variant="secondary" tone="error" accessibilityRole="alert">
          {strings.historyUnavailable}
        </Text>
      ) : null}
    </Collapsible>
  );
}
