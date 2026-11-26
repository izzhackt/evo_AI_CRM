// Рисунок темы урока без фото (веб `LessonIllustration.tsx`): линейный рисунок цветом вторичного текста на тоне бумаги, формы
// цвета поверхности, подписи шрифтом интерфейса; у пройденного урока штрих зелёный. Незнакомый урок получает раскрытую книгу.
// Обложка с фото рисунка не показывает: он нужен урокам, у которых фото нет (новый модуль до выпуска обложек).
import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";

import { sansFont } from "@/theme/fonts";
import { useTheme } from "@/theme/ThemeProvider";

type Ink = Readonly<{ text: string }>;

/** Подпись внутри рисунка: цвет вторичного текста без обводки, `big` - крупный знак (веб `.pt-lesson-art-big`). */
function Label({ x, y, ink, big = false, children }: { x: number; y: number; ink: Ink; big?: boolean; children: string }) {
  return (
    <SvgText x={x} y={y} textAnchor="middle" fill={ink.text} stroke="none" fontSize={big ? 22 : 11} fontWeight="700" fontFamily={sansFont("bold")}>
      {children}
    </SvgText>
  );
}

const ART: Readonly<Record<string, (ink: Ink) => ReactNode>> = {
  // Приветствие и знакомство: два облачка «Hi!» и «Hello».
  "en-m1-l01": (ink) => (
    <>
      <Path d="M8 10h38a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H22l-8 7v-7H8a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6z" />
      <Path d="M50 26h34a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6h-4v7l-8-7H50a6 6 0 0 1-6-6V32a6 6 0 0 1 6-6z" />
      <Label x={27} y={27} ink={ink}>Hi!</Label>
      <Label x={67} y={43} ink={ink}>Hello</Label>
    </>
  ),
  // Алфавит и spelling: три плитки A B C.
  "en-m1-l02": (ink) => (
    <>
      <Rect x={6} y={18} width={24} height={28} rx={5} />
      <Rect x={36} y={12} width={24} height={28} rx={5} />
      <Rect x={66} y={20} width={24} height={28} rx={5} />
      <Label x={18} y={38} ink={ink}>A</Label>
      <Label x={48} y={32} ink={ink}>B</Label>
      <Label x={78} y={40} ink={ink}>C</Label>
    </>
  ),
  // Числа, даты, время: часы и листок календаря.
  "en-m1-l03": (ink) => (
    <>
      <Circle cx={30} cy={32} r={22} />
      <Path d="M30 18v14l9 6" fill="none" />
      <Rect x={58} y={14} width={32} height={36} rx={5} />
      <Path d="M58 24h32M66 10v8M82 10v8" fill="none" />
      <Label x={74} y={43} ink={ink}>12</Label>
    </>
  ),
  // О себе и семье: три человека.
  "en-m1-l04": () => (
    <>
      <Circle cx={24} cy={20} r={8} />
      <Path d="M10 52c0-9 6-16 14-16s14 7 14 16z" />
      <Circle cx={72} cy={20} r={8} />
      <Path d="M58 52c0-9 6-16 14-16s14 7 14 16z" />
      <Circle cx={48} cy={28} r={6} />
      <Path d="M38 54c0-7 4-12 10-12s10 5 10 12z" />
    </>
  ),
  // Школа и учёба: шапка выпускника.
  "en-m1-l05": () => (
    <>
      <Path d="M48 10 88 26 48 42 8 26z" />
      <Path d="M24 33v12c0 5 11 9 24 9s24-4 24-9V33" />
      <Path d="M84 28v16" fill="none" />
      <Circle cx={84} cy={47} r={3} />
    </>
  ),
  // Простые вопросы: облачко с вопросом и who? where?
  "en-m1-l06": (ink) => (
    <>
      <Path d="M10 10h36a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8H30l-10 9v-9H10a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8z" />
      <Label x={28} y={35} ink={ink} big>?</Label>
      <Label x={76} y={24} ink={ink}>who?</Label>
      <Label x={76} y={42} ink={ink}>where?</Label>
    </>
  ),
  // Быть и делать: плитки am / is / do.
  "en-m1-l07": (ink) => (
    <>
      <Rect x={6} y={14} width={26} height={20} rx={5} />
      <Rect x={36} y={30} width={26} height={20} rx={5} />
      <Rect x={66} y={14} width={26} height={20} rx={5} />
      <Path d="M32 26l4 6M62 38l4-6" fill="none" />
      <Label x={19} y={28} ink={ink}>am</Label>
      <Label x={49} y={44} ink={ink}>is</Label>
      <Label x={79} y={28} ink={ink}>do</Label>
    </>
  ),
  // Кафе, транспорт, покупки: чашка и автобус.
  "en-m1-l08": () => (
    <>
      <Path d="M8 24h28v14a10 10 0 0 1-10 10h-8A10 10 0 0 1 8 38z" />
      <Path d="M36 28h4a5 5 0 0 1 0 10h-4M16 12c0 4 4 4 4 8M26 12c0 4 4 4 4 8" fill="none" />
      <Rect x={52} y={12} width={38} height={34} rx={6} />
      <Path d="M52 30h38M58 20h26" fill="none" />
      <Circle cx={61} cy={50} r={4} />
      <Circle cx={81} cy={50} r={4} />
    </>
  ),
  // Чтение коротких текстов: раскрытая книга.
  "en-m1-l09": () => (
    <>
      <Path d="M48 16c-8-5-20-6-34-4v36c14-2 26-1 34 4z" />
      <Path d="M48 16c8-5 20-6 34-4v36c-14-2-26-1-34 4z" />
      <Path d="M22 22h16M22 30h16M22 38h12M58 22h16M58 30h16M58 38h12" fill="none" />
    </>
  ),
  // Слова об учёбе и планах: блокнот с отметками и карандаш.
  "en-m1-l10": () => (
    <>
      <Rect x={12} y={8} width={44} height={48} rx={5} />
      <Path d="M20 20l3 3 6-6M20 34l3 3 6-6M34 20h14M34 34h14M20 48h28" fill="none" />
      <Path d="M74 12l10 10-26 26-12 2 2-12z" />
    </>
  ),
  // Страна и город: метка на сложенной карте.
  "en-m1-l11": () => (
    <>
      <Path d="M8 18l24-8 32 8 24-8v36l-24 8-32-8-24 8z" />
      <Path d="M32 10v36M64 18v36" fill="none" />
      <Path d="M48 46s-12-11-12-20a12 12 0 0 1 24 0c0 9-12 20-12 20z" />
      <Circle cx={48} cy={26} r={4} />
    </>
  ),
  // Повторение модуля: круговые стрелки и отметка.
  "en-m1-l12": () => (
    <>
      <Path d="M70 16a24 24 0 1 0 6 22" fill="none" />
      <Path d="M72 6v12H60" fill="none" />
      <Path d="M38 33l7 7 13-14" fill="none" />
    </>
  ),
};

const FALLBACK = ART["en-m1-l09"];

/** Ключи уроков, для которых есть свой рисунок (тест сверяет их с обложками и веб-картой). */
export const LESSON_ART_KEYS: readonly string[] = Object.keys(ART);

export function LessonArt({ lessonKey, done = false, width }: { lessonKey: string; done?: boolean; width: number }) {
  const { tokens } = useTheme();
  const ink: Ink = { text: tokens.text2 };
  return (
    <View testID="lesson-art" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg viewBox="0 0 96 64" width={width} height={(width * 64) / 96}>
        <G fill={tokens.surface} stroke={done ? tokens.ok : tokens.text2} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          {(ART[lessonKey] ?? FALLBACK)(ink)}
        </G>
      </Svg>
    </View>
  );
}
