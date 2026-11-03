import type { StaticImageData } from "next/image";

import l01 from "../../../content/english/covers/en-m1-l01.webp";
import l02 from "../../../content/english/covers/en-m1-l02.webp";
import l03 from "../../../content/english/covers/en-m1-l03.webp";
import l04 from "../../../content/english/covers/en-m1-l04.webp";
import l05 from "../../../content/english/covers/en-m1-l05.webp";
import l06 from "../../../content/english/covers/en-m1-l06.webp";
import l07 from "../../../content/english/covers/en-m1-l07.webp";
import l08 from "../../../content/english/covers/en-m1-l08.webp";
import l09 from "../../../content/english/covers/en-m1-l09.webp";
import l10 from "../../../content/english/covers/en-m1-l10.webp";
import l11 from "../../../content/english/covers/en-m1-l11.webp";
import l12 from "../../../content/english/covers/en-m1-l12.webp";

/**
 * Обложки уроков «Английского» (03.11.2026, по образцу test-english.com):
 * фото темы на всю обложку и английская плашка темы поверх. Фото
 * сгенерированы в Google Flow (Nano Banana) — не места и не кампусы, поэтому
 * без атрибуции; до выпуска нужно слово шефа (контракт кабинета, принцип 2).
 * Статический импорт, как у фото обзора CSCA: хеш в имени и долгий кэш.
 * Ключ — lessonKey из контента (миграция 199).
 */
export type LessonCover = Readonly<{ photo: StaticImageData; label: string }>;

export const LESSON_COVERS: Readonly<Record<string, LessonCover>> = Object.freeze({
  "en-m1-l01": { photo: l01, label: "Greetings" },
  "en-m1-l02": { photo: l02, label: "The alphabet" },
  "en-m1-l03": { photo: l03, label: "Numbers & time" },
  "en-m1-l04": { photo: l04, label: "Me & my family" },
  "en-m1-l05": { photo: l05, label: "School" },
  "en-m1-l06": { photo: l06, label: "Questions" },
  "en-m1-l07": { photo: l07, label: "To be & to do" },
  "en-m1-l08": { photo: l08, label: "Everyday life" },
  "en-m1-l09": { photo: l09, label: "Reading" },
  "en-m1-l10": { photo: l10, label: "Study plans" },
  "en-m1-l11": { photo: l11, label: "Countries & cities" },
  "en-m1-l12": { photo: l12, label: "Review" },
});
