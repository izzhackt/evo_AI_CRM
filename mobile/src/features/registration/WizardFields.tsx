// Поля мастера анкеты: строка выбора, группа вариантов, выбор из длинного списка с поиском.
import { Check } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

/** Строка выбора (`aria-pressed` веба): весь ряд нажимаем, отметка справа. */
export function ChoiceRow({ label, selected, onPress, testID, multi = false }: { label: string; selected: boolean; onPress: () => void; testID?: string; multi?: boolean }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityState={multi ? { checked: selected } : { selected }}
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
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
        transform: [{ scale: pressed ? tokens.pressScale : 1 }],
      })}
    >
      <Text variant="body" bold={selected} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <View
        style={{ width: 22, height: 22, borderRadius: multi ? 6 : 11, borderWidth: 1, borderColor: selected ? tokens.accent : tokens.controlEdge, backgroundColor: selected ? tokens.accent : "transparent", alignItems: "center", justifyContent: "center" }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {selected ? <Check size={14} strokeWidth={3} color={tokens.onAccent} /> : null}
      </View>
    </Pressable>
  );
}

export type Option = Readonly<{ value: string; label: string }>;

/** Один вариант из короткого списка с подписью-вопросом. */
export function OptionGroup({ legend, options, value, onChange, testIDPrefix }: { legend: string; options: readonly Option[]; value: string; onChange: (value: string) => void; testIDPrefix: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={legend} style={{ gap: 8 }}>
      <Text variant="secondary" tone="text2" bold>
        {legend}
      </Text>
      {options.map((option) => (
        <ChoiceRow key={option.value} label={option.label} selected={option.value === value} onPress={() => onChange(option.value)} testID={`${testIDPrefix}-${option.value}`} />
      ))}
    </View>
  );
}

/** Выбор из длинного списка (гражданство): кнопка открывает лист с поиском. */
export function PickerField({
  label,
  value,
  options,
  placeholder,
  searchLabel,
  closeLabel,
  emptyLabel,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  placeholder: string;
  searchLabel: string;
  closeLabel: string;
  emptyLabel: string;
  onChange: (value: string) => void;
  testID?: string;
}) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle === "" ? options : options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
  }, [options, query]);
  return (
    <View style={{ gap: 6 }}>
      <Text variant="secondary" tone="text2" bold>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        onPress={() => setOpen(true)}
        testID={testID}
        style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: 12, borderRadius: tokens.radiusControl, borderWidth: 1, borderColor: tokens.controlEdge, backgroundColor: tokens.surface }}
      >
        <Text variant="body" tone={selected ? "text" : "text2"}>
          {selected?.label ?? placeholder}
        </Text>
      </Pressable>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: tokens.bg, paddingTop: 16, paddingBottom: Math.max(insets.bottom, 12) }}>
          <View style={{ paddingHorizontal: 16, gap: 12, paddingBottom: 8 }}>
            <Text variant="heading" accessibilityRole="header">
              {label}
            </Text>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchLabel}
              placeholderTextColor={tokens.text2}
              accessibilityLabel={searchLabel}
              autoCorrect={false}
              autoCapitalize="none"
              style={{ minHeight: 48, borderRadius: tokens.radiusControl, borderWidth: 1, borderColor: tokens.controlEdge, backgroundColor: tokens.surface, paddingHorizontal: 12, fontFamily: sansFont(), fontSize: tokens.sizeBody, color: tokens.text }}
              testID={testID ? `${testID}-search` : undefined}
            />
          </View>
          <FlatList
            data={shown}
            keyExtractor={(option) => option.value}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 16 }}
            ListEmptyComponent={
              <Text variant="secondary" tone="text2">
                {emptyLabel}
              </Text>
            }
            renderItem={({ item }) => (
              <ChoiceRow
                label={item.label}
                selected={item.value === value}
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                  setQuery("");
                }}
                testID={testID ? `${testID}-${item.value}` : undefined}
              />
            )}
          />
          <View style={{ paddingHorizontal: 16 }}>
            <Button label={closeLabel} variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Флажок согласия (двойная подпись: текст и ссылка на политику). */
export function CheckRow({ checked, onToggle, children, testID }: { checked: boolean; onToggle: () => void; children: React.ReactNode; testID?: string }) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      testID={testID}
      style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, minHeight: 44, paddingVertical: 4 }}
    >
      <View
        style={{ marginTop: 2, width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: checked ? tokens.accent : tokens.controlEdge, backgroundColor: checked ? tokens.accent : tokens.surface, alignItems: "center", justifyContent: "center" }}
      >
        {checked ? <Check size={16} strokeWidth={3} color={tokens.onAccent} /> : null}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}
