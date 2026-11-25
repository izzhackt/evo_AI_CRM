// Карточка программы в выдаче подбора (веб: ProgramCard.tsx, 10.11.2026): тёмная плашка направления «в облике шапки Главной»
// (красные пятна, едва видный знак EVO, значок направления и его название), уровень, название, длительность и месяцы набора,
// «Подробнее». Своих фото у программ в каталоге нет. Вся карточка - одна кнопка, она открывает окно программы.
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  Cog,
  ConciergeBell,
  FlaskConical,
  Globe,
  GraduationCap,
  Laptop,
  Palette,
  Scale,
  Stethoscope,
  type LucideIcon,
} from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";

import type { ProgramField } from "@web/lib/portal/program-facets";
import { universityLevelKey } from "@web/lib/portal/universities";

import { HeroWash } from "@/features/home/HomeHero";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { EvoMark } from "@/ui/EvoMark";
import { Text } from "@/ui/Text";

import type { UniversityStrings } from "./model";
import { programStarts, type ProgramRow } from "./program-model";

/** Картинка карточки - знак направления: своих фото у программ нет, а фото кампуса одинаково у всех карточек (веб: `FIELD_ICONS`). */
const FIELD_ICONS: Readonly<Record<ProgramField, LucideIcon>> = {
  it: Laptop,
  business: BriefcaseBusiness,
  engineering: Cog,
  medicine: Stethoscope,
  law: Scale,
  design: Palette,
  education: GraduationCap,
  science: FlaskConical,
  social: Globe,
  hospitality: ConciergeBell,
  other: BookOpen,
};

/** `rgb(255 255 255 / 0.05)` из токенов -> строка, понятная React Native. */
function markColor(value: string): string {
  const match = /^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)$/.exec(value);
  return match ? `rgba(${match[1]},${match[2]},${match[3]},${match[4]})` : value;
}

function Fact({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
      <View style={{ marginTop: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon size={16} strokeWidth={1.6} color={tokens.text2} />
      </View>
      <Text variant="secondary" tone="text2" style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}

export function ProgramCard({ row, strings, onOpen, testID }: { row: ProgramRow; strings: UniversityStrings; onOpen: () => void; testID?: string }) {
  const { tokens, scheme } = useTheme();
  const [pressed, setPressed] = useState(false);
  const { program, facets } = row;
  const Icon = FIELD_ICONS[facets.field];
  const level = strings[universityLevelKey(program.level)];
  const fieldLabel = strings[`programField.${facets.field}`];
  const starts = programStarts(program);
  const label = [program.title, level, fieldLabel, program.duration, starts].filter((part): part is string => typeof part === "string" && part !== "").join(". ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={strings.programMore}
      onPress={onOpen}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      testID={testID}
      style={{
        backgroundColor: tokens.surface,
        borderRadius: tokens.radiusCard,
        borderWidth: 1,
        borderColor: tokens.line,
        overflow: "hidden",
        boxShadow: scheme === "dark" ? undefined : tokens.shadowCard,
        transform: [{ scale: pressed ? tokens.pressScale : 1 }],
      }}
    >
      <View style={{ minHeight: 84, padding: 16, flexDirection: "row", alignItems: "center", gap: 12, overflow: "hidden", backgroundColor: tokens.heroBg }}>
        <HeroWash />
        <View pointerEvents="none" style={{ position: "absolute", top: -22, right: -18 }}>
          <EvoMark size={112} color={markColor(tokens.heroMark)} />
        </View>
        <View
          style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: tokens.heroLine, borderRadius: tokens.radiusItem, backgroundColor: markColor(tokens.heroMark) }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon size={28} strokeWidth={1.5} color={tokens.heroInk} />
        </View>
        <Text variant="caption" style={{ flex: 1, color: tokens.heroMuted, fontFamily: sansFont("semibold"), letterSpacing: 0.5, textTransform: "uppercase" }}>
          {fieldLabel}
        </Text>
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 8 }}>
        <Text variant="caption" tone="text2" style={{ fontFamily: sansFont("semibold"), letterSpacing: 0.7, textTransform: "uppercase" }}>
          {level}
        </Text>
        <Text variant="body" numberOfLines={3} style={{ fontFamily: sansFont("semibold") }}>
          {program.title}
        </Text>
        {program.duration || starts ? (
          <View style={{ gap: 6 }}>
            {program.duration ? <Fact icon={Clock3}>{program.duration}</Fact> : null}
            {starts ? <Fact icon={CalendarDays}>{starts}</Fact> : null}
          </View>
        ) : null}
      </View>
      <View style={{ marginTop: 12, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, borderTopWidth: 1, borderTopColor: tokens.line }}>
        <Text variant="secondary" tone="accent" style={{ fontFamily: sansFont("semibold") }}>
          {strings.programMore}
        </Text>
        <ArrowRight size={16} strokeWidth={1.8} color={tokens.accent} />
      </View>
    </Pressable>
  );
}
