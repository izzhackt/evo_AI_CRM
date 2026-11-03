import type { ReactNode } from "react";

/**
 * Иллюстрации обложек уроков «Английского» (03.11.2026): линейные рисунки по
 * теме урока на тоне бумаги — штрих цвета вторичного текста, заливка цвета
 * поверхности, без новых цветов. Не фото: по контракту кабинета фото только
 * настоящие и с атрибуцией. Ключ — lessonKey из контента (миграция 199);
 * незнакомый урок получает раскрытую книгу.
 */
const ART: Readonly<Record<string, ReactNode>> = {
  // Приветствие и знакомство: два облачка «Hi!» и «Hello».
  "en-m1-l01": (
    <>
      <path d="M8 10h38a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H22l-8 7v-7H8a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6z" />
      <path d="M50 26h34a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6h-4v7l-8-7H50a6 6 0 0 1-6-6V32a6 6 0 0 1 6-6z" />
      <text x="27" y="27" textAnchor="middle">Hi!</text>
      <text x="67" y="43" textAnchor="middle">Hello</text>
    </>
  ),
  // Алфавит и spelling: три плитки A B C.
  "en-m1-l02": (
    <>
      <rect x="6" y="18" width="24" height="28" rx="5" />
      <rect x="36" y="12" width="24" height="28" rx="5" />
      <rect x="66" y="20" width="24" height="28" rx="5" />
      <text x="18" y="38" textAnchor="middle">A</text>
      <text x="48" y="32" textAnchor="middle">B</text>
      <text x="78" y="40" textAnchor="middle">C</text>
    </>
  ),
  // Числа, даты, время: часы и листок календаря.
  "en-m1-l03": (
    <>
      <circle cx="30" cy="32" r="22" />
      <path d="M30 18v14l9 6" fill="none" />
      <rect x="58" y="14" width="32" height="36" rx="5" />
      <path d="M58 24h32M66 10v8M82 10v8" fill="none" />
      <text x="74" y="43" textAnchor="middle">12</text>
    </>
  ),
  // О себе и семье: три человека.
  "en-m1-l04": (
    <>
      <circle cx="24" cy="20" r="8" />
      <path d="M10 52c0-9 6-16 14-16s14 7 14 16z" />
      <circle cx="72" cy="20" r="8" />
      <path d="M58 52c0-9 6-16 14-16s14 7 14 16z" />
      <circle cx="48" cy="28" r="6" />
      <path d="M38 54c0-7 4-12 10-12s10 5 10 12z" />
    </>
  ),
  // Школа и учёба: шапка выпускника.
  "en-m1-l05": (
    <>
      <path d="M48 10 88 26 48 42 8 26z" />
      <path d="M24 33v12c0 5 11 9 24 9s24-4 24-9V33" />
      <path d="M84 28v16" fill="none" />
      <circle cx="84" cy="47" r="3" />
    </>
  ),
  // Простые вопросы: облачко с вопросом и who? where?
  "en-m1-l06": (
    <>
      <path d="M10 10h36a8 8 0 0 1 8 8v18a8 8 0 0 1-8 8H30l-10 9v-9H10a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8z" />
      <text x="28" y="35" textAnchor="middle" className="pt-lesson-art-big">?</text>
      <text x="76" y="24" textAnchor="middle">who?</text>
      <text x="76" y="42" textAnchor="middle">where?</text>
    </>
  ),
  // Быть и делать: плитки am / is / do.
  "en-m1-l07": (
    <>
      <rect x="6" y="14" width="26" height="20" rx="5" />
      <rect x="36" y="30" width="26" height="20" rx="5" />
      <rect x="66" y="14" width="26" height="20" rx="5" />
      <path d="M32 26l4 6M62 38l4-6" fill="none" />
      <text x="19" y="28" textAnchor="middle">am</text>
      <text x="49" y="44" textAnchor="middle">is</text>
      <text x="79" y="28" textAnchor="middle">do</text>
    </>
  ),
  // Кафе, транспорт, покупки: чашка и автобус.
  "en-m1-l08": (
    <>
      <path d="M8 24h28v14a10 10 0 0 1-10 10h-8A10 10 0 0 1 8 38z" />
      <path d="M36 28h4a5 5 0 0 1 0 10h-4M16 12c0 4 4 4 4 8M26 12c0 4 4 4 4 8" fill="none" />
      <rect x="52" y="12" width="38" height="34" rx="6" />
      <path d="M52 30h38M58 20h26" fill="none" />
      <circle cx="61" cy="50" r="4" />
      <circle cx="81" cy="50" r="4" />
    </>
  ),
  // Чтение коротких текстов: раскрытая книга.
  "en-m1-l09": (
    <>
      <path d="M48 16c-8-5-20-6-34-4v36c14-2 26-1 34 4z" />
      <path d="M48 16c8-5 20-6 34-4v36c-14-2-26-1-34 4z" />
      <path d="M22 22h16M22 30h16M22 38h12M58 22h16M58 30h16M58 38h12" fill="none" />
    </>
  ),
  // Слова об учёбе и планах: блокнот с отметками и карандаш.
  "en-m1-l10": (
    <>
      <rect x="12" y="8" width="44" height="48" rx="5" />
      <path d="M20 20l3 3 6-6M20 34l3 3 6-6M34 20h14M34 34h14M20 48h28" fill="none" />
      <path d="M74 12l10 10-26 26-12 2 2-12z" />
    </>
  ),
  // Страна и город: метка на сложенной карте.
  "en-m1-l11": (
    <>
      <path d="M8 18l24-8 32 8 24-8v36l-24 8-32-8-24 8z" />
      <path d="M32 10v36M64 18v36" fill="none" />
      <path d="M48 46s-12-11-12-20a12 12 0 0 1 24 0c0 9-12 20-12 20z" />
      <circle cx="48" cy="26" r="4" />
    </>
  ),
  // Повторение модуля: круговые стрелки и отметка.
  "en-m1-l12": (
    <>
      <path d="M70 16a24 24 0 1 0 6 22" fill="none" />
      <path d="M72 6v12H60" fill="none" />
      <path d="M38 33l7 7 13-14" fill="none" />
    </>
  ),
};

const FALLBACK = ART["en-m1-l09"];

export function LessonIllustration({ lessonKey }: Readonly<{ lessonKey: string }>) {
  return (
    <svg className="pt-lesson-art" viewBox="0 0 96 64" aria-hidden="true">
      {ART[lessonKey] ?? FALLBACK}
    </svg>
  );
}
