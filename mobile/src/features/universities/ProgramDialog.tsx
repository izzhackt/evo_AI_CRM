// Окно программы (веб: `<dialog>` в ProgramCard.tsx, на телефоне - лист снизу): уровень и название, длительность и язык
// обучения, описание, страница программы и наборы с выбором. Закрывается крестиком, нажатием «Назад» и (iOS) жестом вниз: жест у
// листа iOS по умолчанию выключен (`allowSwipeDismissal`), он включён, и закрывает окно тем же путём, что крестик (`onRequestClose`).
import { X } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { universityLevelKey } from "@web/lib/portal/universities";

import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { useReducedMotion } from "@/ui/a11y";
import { MIN_TARGET } from "@/ui/CardParts";
import { Text } from "@/ui/Text";

import { ExternalLink } from "./ExternalLink";
import type { UniversityStrings } from "./model";
import type { ProgramRow } from "./program-model";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Text variant="secondary">
      <Text variant="secondary" tone="text2">
        {label}:{" "}
      </Text>
      {value}
    </Text>
  );
}

/**
 * `row === null` - окно закрыто. Содержимое последней программы остаётся, пока окно уезжает вниз, а `children` (наборы) строит
 * вызывающий: у них своё состояние и тексты действий.
 */
export function ProgramDialog({
  row,
  strings,
  onClose,
  onDismiss,
  children,
}: {
  row: ProgramRow | null;
  strings: UniversityStrings;
  onClose: () => void;
  /** Окно полностью закрыто (iOS); на Android этого события нет. */
  onDismiss?: () => void;
  children: (row: ProgramRow) => ReactNode;
}) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  // «Уменьшить движение»: лист появляется без выезда снизу (веб: `prefers-reduced-motion`).
  const reduced = useReducedMotion();
  // Содержимое последней программы остаётся, пока окно уезжает вниз: состояние обновляется во время отрисовки, как советует React.
  const [last, setLast] = useState<ProgramRow | null>(null);
  if (row !== null && row !== last) setLast(row);
  const shown = row ?? last;
  return (
    <Modal visible={row !== null} animationType={reduced ? "none" : "slide"} presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onClose} onDismiss={onDismiss} testID="program-dialog">
      <View style={{ flex: 1, backgroundColor: tokens.surface }}>
        {shown ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 20, paddingBottom: Math.max(insets.bottom, 16) + 16, gap: 12 }} keyboardShouldPersistTaps="handled">
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text variant="caption" tone="text2" style={{ fontFamily: sansFont("semibold"), letterSpacing: 0.7, textTransform: "uppercase" }}>
                  {strings[universityLevelKey(shown.program.level)]}
                </Text>
                <Text variant="heading" accessibilityRole="header" testID="program-dialog-title">
                  {shown.program.title}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.mapCloseCard}
                onPress={onClose}
                testID="program-dialog-close"
                style={{ width: MIN_TARGET, height: MIN_TARGET, marginTop: -10, marginRight: -10, alignItems: "center", justifyContent: "center" }}
              >
                <X size={20} strokeWidth={1.6} color={tokens.text2} />
              </Pressable>
            </View>
            {shown.program.duration || shown.program.language ? (
              <View style={{ gap: 4 }}>
                {shown.program.duration ? <Fact label={strings.duration} value={shown.program.duration} /> : null}
                {shown.program.language ? <Fact label={strings.teachingLanguage} value={shown.program.language} /> : null}
              </View>
            ) : null}
            {shown.program.summary ? <Text variant="body">{shown.program.summary}</Text> : null}
            <ExternalLink url={shown.program.sourceUrl} label={strings.programPage} />
            {children(shown)}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}
