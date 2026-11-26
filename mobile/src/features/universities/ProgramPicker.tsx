// Подбор программ вуза (веб #1447, ProgramList.tsx): от четырёх программ над выдачей поиск по названию и четыре поля - «Уровень»,
// «Направление», «Начало», «Длительность»; у каждого варианта число программ с учётом остальных полей, пустые варианты
// недоступны; «Подходит N из M» и «Сбросить фильтр». Пока ничего не выбрано - первые четыре карточки и «Показать все N»; с
// любым полем или запросом - все подходящие. «Километровый список» из 270 программ UTM владельцу не годился (10.11.2026).
import { ChevronDown, Search, X } from "lucide-react-native";
import { useDeferredValue, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { formatPortalString } from "@web/lib/portal/i18n";
import type { ProgramPick } from "@web/lib/portal/program-facets";

import type { Lang } from "@/i18n";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { announce, useReducedMotion } from "@/ui/a11y";
import { Button } from "@/ui/Button";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

import { useAnnounceResults } from "./announce-results";
import type { UniversityStrings } from "./model";
import { ProgramCard } from "./ProgramCard";
import { FACETS, FILTER_FROM, NO_PICK, pickPrograms, programCountLabel, type Facet, type PickerOptions, type ProgramRow } from "./program-model";
import { useStagedCount } from "./staged";

/** Длина запроса (веб: `maxLength={100}`). */
const SEARCH_MAX = 100;

/** Строка варианта в окне выбора поля: одна кнопка, отметка справа; пустой вариант недоступен (веб: `<option disabled>`). */
function FacetRow({ label, selected, disabled, onPress, testID }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; testID?: string }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={{
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: tokens.radiusControl,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? tokens.accent : tokens.controlEdge,
        backgroundColor: selected ? tokens.accentSoft : tokens.surface,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text variant="body" bold={selected} style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Поле подбора: кнопка с выбранным значением, нажатие открывает лист со всеми вариантами и числом программ у каждого
 * (веб: `<select>` с «Название (N)»). Вариант без программ при остальных выбранных полях недоступен, если он не выбран сейчас.
 */
function FacetField({
  facet,
  label,
  anyLabel,
  closeLabel,
  options,
  value,
  count,
  onChange,
}: {
  facet: Facet;
  label: string;
  anyLabel: string;
  closeLabel: string;
  options: PickerOptions[Facet];
  value: string;
  count: (value: string) => number;
  onChange: (value: string) => void;
}) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value)?.label ?? anyLabel;
  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <View style={{ gap: 6, flexGrow: 1, flexBasis: "45%", minWidth: 140 }}>
      <Text variant="secondary" tone="text2" bold>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        onPress={() => setOpen(true)}
        testID={`facet-${facet}`}
        style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 12, borderRadius: tokens.radiusControl, borderWidth: 1, borderColor: tokens.controlEdge, backgroundColor: tokens.surface }}
      >
        <Text variant="secondary" bold={value !== ""} numberOfLines={1} style={{ flex: 1 }}>
          {current}
        </Text>
        <ChevronDown size={18} strokeWidth={1.75} color={tokens.text2} />
      </Pressable>
      <Modal visible={open} animationType={reduced ? "none" : "slide"} presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: tokens.bg, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 12) }}>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <Text variant="heading" accessibilityRole="header">
              {label}
            </Text>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 16 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
            <FacetRow label={anyLabel} selected={value === ""} disabled={false} onPress={() => pick("")} testID={`facet-${facet}-any`} />
            {options.map((option) => {
              const total = count(option.value);
              return (
                <FacetRow
                  key={option.value}
                  label={`${option.label} (${total})`}
                  selected={option.value === value}
                  disabled={total === 0 && option.value !== value}
                  onPress={() => pick(option.value)}
                  testID={`facet-${facet}-${option.value}`}
                />
              );
            })}
          </ScrollView>
          <View style={{ paddingHorizontal: 16 }}>
            <Button label={closeLabel} variant="ghost" onPress={() => setOpen(false)} testID={`facet-${facet}-close`} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Поиск по названию программы: значок, поле и крестик очистки (веб: `.pt-uni-search` в подборе). */
function ProgramSearch({ value, onChange, strings }: { value: string; onChange: (value: string) => void; strings: UniversityStrings }) {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", minHeight: 44, gap: 8, paddingLeft: 12, borderWidth: 1, borderColor: tokens.controlEdge, borderRadius: tokens.radiusControl, backgroundColor: tokens.surface }}>
      <Search size={18} strokeWidth={1.6} color={tokens.text2} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={strings.programSearchPlaceholder}
        placeholderTextColor={tokens.text2}
        accessibilityLabel={strings.programSearchLabel}
        maxLength={SEARCH_MAX}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        testID="program-search"
        style={{ flex: 1, minHeight: 44, fontFamily: sansFont(), fontSize: tokens.sizeSecondary, color: tokens.text }}
      />
      {value !== "" ? (
        <Pressable accessibilityRole="button" accessibilityLabel={strings.searchClear} onPress={() => onChange("")} hitSlop={4} testID="program-search-clear" style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: "center", justifyContent: "center" }}>
          <X size={18} strokeWidth={1.75} color={tokens.text2} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function ProgramPicker({
  rows,
  options,
  strings,
  lang,
  onOpen,
}: {
  rows: readonly ProgramRow[];
  options: PickerOptions;
  strings: UniversityStrings;
  lang: Lang;
  onOpen: (programId: string) => void;
}) {
  const { tokens } = useTheme();
  const filter = rows.length >= FILTER_FROM;
  const [picked, setPicked] = useState<ProgramPick>(NO_PICK);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const trimmed = useDeferredValue(query).trim();
  const view = useMemo(() => pickPrograms(rows, trimmed, picked, expanded, filter), [rows, trimmed, picked, expanded, filter]);
  const signature = view.visible.length === 0 ? "" : `${view.visible[0].program.id}|${view.visible[view.visible.length - 1].program.id}|${view.visible.length}`;
  const built = useStagedCount(view.visible.length, signature);
  const total = programCountLabel(rows.length, strings, lang);
  const summary = view.active ? formatPortalString(strings.programsFound, { shown: String(view.shown.length), total: String(rows.length) }) : total;
  // «Подходит N из M» читается, когда студент что-то выбрал или набрал; число всех программ при открытии страницы молча.
  useAnnounceResults(filter && view.active ? summary : null);
  const reset = () => {
    setPicked(NO_PICK);
    setQuery("");
    setExpanded(false);
  };
  const labels: Readonly<Record<Facet, string>> = { level: strings.levelLabel, field: strings.programFieldLabel, month: strings.programMonthLabel, duration: strings.duration };
  const anyLabels: Readonly<Record<Facet, string>> = { level: strings.programsAnyLevel, field: strings.programsAnyField, month: strings.programsAnyMonth, duration: strings.programsAnyDuration };
  return (
    <View style={{ gap: 16 }}>
      {filter ? (
        <View style={{ gap: 12, padding: 12, borderRadius: tokens.radiusCard, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.surface }} testID="program-filter">
          <ProgramSearch value={query} onChange={setQuery} strings={strings} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {FACETS.filter((facet) => options[facet].length > 1).map((facet) => (
              <FacetField
                key={facet}
                facet={facet}
                label={labels[facet]}
                anyLabel={anyLabels[facet]}
                closeLabel={strings.mapCloseCard}
                options={options[facet]}
                value={picked[facet]}
                count={(value) => view.count(facet, value)}
                onChange={(value) => setPicked((current) => ({ ...current, [facet]: value }))}
              />
            ))}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
            <Text variant="secondary" bold accessibilityLiveRegion="polite" testID="program-found">
              {summary}
            </Text>
            {view.active ? (
              <Pressable accessibilityRole="button" accessibilityLabel={strings.programsReset} onPress={reset} testID="program-reset" style={{ minHeight: MIN_TARGET, justifyContent: "center" }}>
                <Text variant="secondary" tone="accent" bold>
                  {strings.programsReset}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      {view.shown.length > 0 ? (
        <View style={{ gap: 16 }} testID="program-cards">
          {view.visible.slice(0, built).map((row) => (
            <ProgramCard key={row.program.id} row={row} strings={strings} onOpen={() => onOpen(row.program.id)} testID={`program-${row.program.id}`} />
          ))}
        </View>
      ) : filter ? (
        <View style={{ gap: 8, alignItems: "flex-start" }} testID="program-empty">
          <Text variant="body">{strings.programsEmpty}</Text>
          <Button variant="ghost" label={strings.programsReset} onPress={reset} testID="program-empty-reset" />
        </View>
      ) : null}
      {view.visible.length < view.shown.length ? (
        <Button
          variant="ghost"
          label={formatPortalString(strings.programsShowAll, { count: String(view.shown.length) })}
          onPress={() => {
            setExpanded(true);
            // Веб переводит фокус на первую новую карточку; читалке на телефоне сообщается, сколько программ теперь показано.
            announce(programCountLabel(view.shown.length, strings, lang));
          }}
          testID="program-show-all"
        />
      ) : null}
    </View>
  );
}
