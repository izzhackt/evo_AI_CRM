// Обложки «Английского» как на сайте (`LessonCover.tsx`, страница урока `lesson/[lessonId]/page.tsx`): плитка списка с фото 4:3,
// номером урока белым чипом слева сверху и английской плашкой темы справа снизу; шапка страницы урока с тем же фото. Цвета плашки
// и чипа - поверхность и текст темы (в тёмной теме тёмная плашка с светлым текстом, а не светлый текст на тёмной подложке).
// Нет фото у урока (новый модуль до выпуска обложек): номер и линейный рисунок на тоне бумаги.
import { Image, StyleSheet, View } from "react-native";

import { LESSON_COVERS } from "@/features/learning/english/covers";
import { LessonArt } from "@/features/learning/english/LessonArt";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

/** Английская плашка темы: поверхность, текст, заглавные, в одну строку с многоточием. */
function Plaque({ label, size, inset }: { label: string; size: "tab" | "label"; inset: number }) {
  const { tokens } = useTheme();
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: inset, right: inset, bottom: inset, alignItems: "flex-end" }}>
      <View testID="lesson-plaque" style={{ maxWidth: "100%", paddingHorizontal: size === "tab" ? 6 : 10, paddingVertical: size === "tab" ? 3 : 4, borderRadius: 6, backgroundColor: tokens.surface }}>
        <Text variant={size === "tab" ? "tab" : "secondary"} bold numberOfLines={1} accessibilityLanguage="en" style={{ color: tokens.text, textTransform: "uppercase", letterSpacing: 0.3 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Обложка плитки: `width` - ширина плитки (по ней считается рисунок без фото). Декоративная: название и номер читаются из тела плитки. */
export function LessonTileCover({ lessonKey, orderIndex, done, width }: { lessonKey: string; orderIndex: number; done: boolean; width: number }) {
  const { tokens } = useTheme();
  const cover = LESSON_COVERS[lessonKey];
  const num = String(orderIndex).padStart(2, "0");
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={`lesson-cover-${lessonKey}`}
      style={{ width: "100%", aspectRatio: 4 / 3, backgroundColor: cover ? tokens.line : tokens.bg, borderBottomWidth: 1, borderBottomColor: tokens.line, overflow: "hidden" }}
    >
      {cover ? (
        <>
          <Image source={cover.photo} accessibilityIgnoresInvertColors resizeMode="cover" style={StyleSheet.absoluteFill} testID="lesson-cover-photo" />
          <View testID="lesson-number" style={{ position: "absolute", left: 8, top: 8, paddingHorizontal: 8, paddingVertical: 2, borderRadius: tokens.radiusChip, backgroundColor: tokens.surface }}>
            <Text variant="tab" bold style={{ fontVariant: ["tabular-nums"] }}>
              {num}
            </Text>
          </View>
          <Plaque label={cover.label} size="tab" inset={8} />
        </>
      ) : (
        <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, paddingHorizontal: 12, paddingVertical: 10 }}>
          <Text bold tone={done ? "ok" : "text2"} style={{ fontSize: 44, lineHeight: 44, letterSpacing: -1.76, fontVariant: ["tabular-nums"] }}>
            {num}
          </Text>
          <View style={{ alignSelf: "center" }}>
            <LessonArt lessonKey={lessonKey} done={done} width={Math.min(150, Math.round(width * 0.62))} />
          </View>
        </View>
      )}
    </View>
  );
}

/** Фото темы над заголовком урока (веб `.pt-lesson-hero`: 132 pt на телефоне, плашка темы справа снизу). Урок без фото шапки не имеет. */
export function LessonHero({ lessonKey }: { lessonKey: string }) {
  const { tokens } = useTheme();
  const cover = LESSON_COVERS[lessonKey];
  if (!cover) return null;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="lesson-hero" style={{ height: 132, borderRadius: tokens.radiusCard, overflow: "hidden", backgroundColor: tokens.skeleton }}>
      <Image source={cover.photo} accessibilityIgnoresInvertColors resizeMode="cover" style={StyleSheet.absoluteFill} testID="lesson-hero-photo" />
      <Plaque label={cover.label} size="label" inset={12} />
    </View>
  );
}
