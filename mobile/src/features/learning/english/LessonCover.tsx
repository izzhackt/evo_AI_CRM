// Обложки «Английского» как на сайте (`LessonCover.tsx`, страница урока `lesson/[lessonId]/page.tsx`): плитка списка с фото 4:3,
// номером урока белым чипом слева сверху (у пройденного урока цифра зелёная: правило `[data-state="done"] .pt-lesson-num`
// сильнее правила фото) и английской плашкой темы справа снизу; шапка страницы урока с тем же фото. Цвета плашки и чипа - поверхность
// и текст темы (в тёмной теме тёмная плашка со светлым текстом, а не светлый текст на тёмной подложке).
// Нет фото у урока (новый модуль до выпуска обложек): номер и линейный рисунок на тоне бумаги.
import { Image, StyleSheet, View, useWindowDimensions } from "react-native";

import { LESSON_COVERS } from "@/features/learning/english/covers";
import { LessonArt } from "@/features/learning/english/LessonArt";
import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

/** Поля обложки без фото по бокам и просвет между цифрой и рисунком (веб, телефон: `padding: 14px 18px` сужен до 12, `gap: 12`). */
const FALLBACK_PAD_X = 12;
const FALLBACK_GAP = 12;
/** Самая широкая цифра номера: два знака по 44 pt жирным с обратным трекингом занимают 41-52 pt; запас до 56. */
const FALLBACK_NUMBER_MAX = 56;

/**
 * Ширина рисунка у урока без фото. Веб: 62 % поля обложки, не больше 150 px, и рисунок сжимается, когда не хватает места. Здесь доля
 * считается от поля обложки (ширина плитки без боковых отступов), а не от всей плитки, и сверху ограничена тем, что остаётся
 * рядом с цифрой и просветом: рисунок не вылезает за обложку ни на 320 pt, ни на 430 pt.
 */
export function fallbackArtWidth(tileWidth: number): number {
  const content = tileWidth - 2 * FALLBACK_PAD_X;
  return Math.max(0, Math.min(150, Math.round(content * 0.62), content - FALLBACK_NUMBER_MAX - FALLBACK_GAP));
}

/** Английская плашка темы: поверхность, текст, заглавные, в одну строку с многоточием; вес 800 сайта у приложения самый жирный из шрифтов (700). */
function Plaque({ label, size, inset }: { label: string; size: "tab" | "label"; inset: number }) {
  const { tokens } = useTheme();
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: inset, right: inset, bottom: inset, alignItems: "flex-end" }}>
      <View testID="lesson-plaque" style={{ maxWidth: "100%", paddingHorizontal: size === "tab" ? 6 : 10, paddingVertical: size === "tab" ? 3 : 4, borderRadius: 6, backgroundColor: tokens.surface }}>
        <Text variant={size === "tab" ? "tab" : "secondary"} numberOfLines={1} accessibilityLanguage="en" style={{ color: tokens.text, fontFamily: sansFont("bold"), textTransform: "uppercase", letterSpacing: 0.3 }}>
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
            <Text variant="tab" bold tone={done ? "ok" : "text"} style={{ fontVariant: ["tabular-nums"] }} testID="lesson-number-text">
              {num}
            </Text>
          </View>
          <Plaque label={cover.label} size="tab" inset={8} />
        </>
      ) : (
        <View style={{ flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: FALLBACK_GAP, paddingHorizontal: FALLBACK_PAD_X, paddingVertical: 10 }}>
          <Text bold tone={done ? "ok" : "text2"} style={{ fontSize: 44, lineHeight: 44, letterSpacing: -1.76, fontVariant: ["tabular-nums"] }} testID="lesson-number-text">
            {num}
          </Text>
          <View style={{ alignSelf: "center", flexShrink: 1 }}>
            <LessonArt lessonKey={lessonKey} done={done} width={fallbackArtWidth(width)} />
          </View>
        </View>
      )}
    </View>
  );
}

/** Высота фото над заголовком урока: 180 на широком экране, 132 с 520 pt и уже (веб `.pt-lesson-hero`); приложение портретное, но планшет на Android шире. */
export function lessonHeroHeight(windowWidth: number): number {
  return windowWidth > 520 ? 180 : 132;
}

/** Фото темы над заголовком урока (плашка темы справа снизу). Урок без фото шапки не имеет. */
export function LessonHero({ lessonKey }: { lessonKey: string }) {
  const { tokens } = useTheme();
  const { width } = useWindowDimensions();
  const cover = LESSON_COVERS[lessonKey];
  if (!cover) return null;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="lesson-hero" style={{ height: lessonHeroHeight(width), borderRadius: tokens.radiusCard, overflow: "hidden", backgroundColor: tokens.skeleton }}>
      <Image source={cover.photo} accessibilityIgnoresInvertColors resizeMode="cover" style={StyleSheet.absoluteFill} testID="lesson-hero-photo" />
      <Plaque label={cover.label} size="label" inset={12} />
    </View>
  );
}
