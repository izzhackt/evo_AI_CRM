// Строка выбора файла для комплекта: у обязательного требования выбор среди текущей отправки, сохранённого файла и сохранённых
// версий; необязательное требование сначала включают в комплект. Веб: `PackageSelection.tsx` (там `<select>`, здесь список вариантов).
import { Check } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";

import type {
  ApplicationDocumentFile,
  ApplicationDocumentItemState,
  ApplicationDocumentReusableVersion,
  ApplicationDocumentSelection,
  ApplicationDocumentVersionCursor,
} from "@web/lib/portal/application-documents";
import type { ApplicationPackageSelection } from "@web/lib/portal/application-packages";
import type { ApplicationRequirementItemV2 } from "@web/lib/portal/application-requirements-v2";

import { usePortalApi } from "@/api/PortalApi";
import { readReusableVersions } from "@/api/preparations-documents";
import { usePreparation } from "@/features/preparations/context";
import { VersionRow } from "@/features/preparations/SavedVersions";
import type { PackageStrings } from "@/features/preparations/package-strings";
import { useTheme } from "@/theme/ThemeProvider";
import { announce } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

type Candidate = Readonly<{ selection: ApplicationDocumentSelection; file: ApplicationDocumentFile }>;

/** Все файлы, из которых можно выбрать для требования: текущая отправка, сохранённый файл, сохранённые версии; без повторов по версии. */
export function packageCandidates(state: Pick<ApplicationDocumentItemState, "submission" | "savedDraft" | "reusableVersions">, more: readonly ApplicationDocumentReusableVersion[] = []): readonly Candidate[] {
  const found: Candidate[] = [];
  if (state.submission) found.push({ selection: { kind: "existing_version", documentVersionId: state.submission.file.documentVersionId }, file: state.submission.file });
  if (state.savedDraft) found.push({ selection: { kind: "program_upload", documentVersionId: state.savedDraft.file.documentVersionId, uploadContextId: state.savedDraft.uploadContextId }, file: state.savedDraft.file });
  found.push(...state.reusableVersions, ...more);
  return found.filter((candidate, index) => found.findIndex((other) => other.file.documentVersionId === candidate.file.documentVersionId) === index);
}

function NoneRow({ label, selected, disabled, onPress, testID }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; testID: string }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={{ minHeight: MIN_TARGET + 4, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: tokens.radiusItem, borderWidth: selected ? 2 : 1, borderColor: selected ? tokens.accent : tokens.controlEdge, backgroundColor: tokens.surface, opacity: disabled ? 0.6 : 1 }}
    >
      <Text variant="body" tone="text2" bold={selected} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      {selected ? <Check size={18} strokeWidth={2} color={tokens.accent} /> : null}
    </Pressable>
  );
}

export function PackageSelectionRow({ item, state, selected, included, disabled, strings: t, onInclude, onChange }: {
  item: ApplicationRequirementItemV2;
  state: ApplicationDocumentItemState;
  selected: ApplicationPackageSelection | undefined;
  included: boolean;
  disabled: boolean;
  strings: PackageStrings;
  onInclude: (included: boolean) => void;
  onChange: (selection: ApplicationPackageSelection | null) => void;
}) {
  const { tokens } = useTheme();
  const api = usePortalApi();
  const { scope } = usePreparation();
  // Страницы «Показать ещё файлы», которые студент уже открыл. Строка при обновлении не пересоздаётся (раньше её ключ рос вместе с
  // `epoch`): выбранный файл со второй страницы остаётся в списке, а не превращается в «Выбранный файл недоступен». Пока ничего не
  // загружено, курсор берётся из свежего ответа (обновление могло изменить первую страницу и появление «Показать ещё файлы»).
  const [loaded, setLoaded] = useState<Readonly<{ versions: readonly ApplicationDocumentReusableVersion[]; cursor: ApplicationDocumentVersionCursor | null }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const cursor = loaded ? loaded.cursor : state.reusableVersionsNextCursor;
  const candidates = packageCandidates(state, loaded?.versions ?? []);
  const value = selected?.selection.documentVersionId ?? "";
  async function load() {
    if (lock.current || !cursor) return;
    lock.current = true;
    setLoading(true);
    setFailed(false);
    try {
      const page = await readReusableVersions(api.transport, { studentCaseId: scope.studentCaseId, applicationId: scope.applicationId, requirementItemId: item.requirementItemId }, cursor);
      setLoaded((old) => ({ versions: [...(old?.versions ?? []), ...page.versions], cursor: page.nextCursor }));
    } catch {
      setFailed(true);
      // Роль «alert» на iPhone молчит: сбой нужно сказать читалке самим.
      announce(t.unavailable);
    } finally {
      lock.current = false;
      setLoading(false);
    }
  }
  const choose = (candidate: Candidate | null) => onChange(candidate ? { requirementItemId: item.requirementItemId, selection: candidate.selection, expectedPreviousSubmissionId: state.submission?.submissionId ?? null } : null);
  return (
    <View style={{ gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: tokens.line }} testID={`prep-package-row-${item.requirementItemId}`}>
      <Text variant="body" bold accessibilityRole="header">
        {item.label}
      </Text>
      <Text variant="caption" tone="text2">
        {item.required ? t.required : t.optionalLabel}
      </Text>
      {!item.required ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`${t.optional}: ${item.label}`}
          accessibilityState={{ checked: included, disabled }}
          disabled={disabled}
          onPress={() => onInclude(!included)}
          testID={`prep-package-include-${item.requirementItemId}`}
          style={{ minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 10, opacity: disabled ? 0.6 : 1 }}
        >
          <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: included ? tokens.accent : tokens.controlEdge, backgroundColor: included ? tokens.accent : "transparent", alignItems: "center", justifyContent: "center" }}>
            {included ? <Check size={14} strokeWidth={3} color={tokens.onAccent} /> : null}
          </View>
          <Text variant="body">{t.optional}</Text>
        </Pressable>
      ) : null}
      {included ? (
        <View style={{ gap: 8 }}>
          <Text variant="secondary" tone="text2">
            {t.select}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={`${t.select}: ${item.label}`} style={{ gap: 8 }}>
            <NoneRow label={t.none} selected={value === ""} disabled={disabled || loading} onPress={() => choose(null)} testID={`prep-package-none-${item.requirementItemId}`} />
            {value && !candidates.some((candidate) => candidate.file.documentVersionId === value) ? (
              <NoneRow label={t.fileUnavailable} selected disabled onPress={() => undefined} testID={`prep-package-missing-${item.requirementItemId}`} />
            ) : null}
            {candidates.map((candidate) => (
              <VersionRow
                key={candidate.file.documentVersionId}
                file={candidate.file}
                selected={candidate.file.documentVersionId === value}
                disabled={disabled || loading}
                onPress={() => choose(candidate)}
                testID={`prep-package-version-${item.requirementItemId}-${candidate.file.documentVersionId}`}
              />
            ))}
          </View>
          {candidates.length === 0 ? (
            <Text variant="secondary" tone="text2">
              {t.noFile}
            </Text>
          ) : null}
          {cursor ? <Button variant="ghost" label={loading ? t.loading : t.moreFiles} onPress={() => void load()} disabled={disabled || loading} testID={`prep-package-more-${item.requirementItemId}`} /> : null}
          {failed ? (
            <Text variant="secondary" tone="error" accessibilityRole="alert">
              {t.unavailable}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
