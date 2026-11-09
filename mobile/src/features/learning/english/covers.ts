// Обложки уроков «Английского»: те же WebP, что у веба (src/content/english/covers), копий нет; подписи как в вебе
// (components/portal/english/lesson-cover-files.ts). Ключ: lessonKey из контента (миграция 199).
import type { ImageSourcePropType } from "react-native";

export const LESSON_COVERS: Readonly<Record<string, Readonly<{ photo: ImageSourcePropType; label: string }>>> = {
  "en-m1-l01": { photo: require("../../../../../src/content/english/covers/en-m1-l01.webp"), label: "Greetings" },
  "en-m1-l02": { photo: require("../../../../../src/content/english/covers/en-m1-l02.webp"), label: "The alphabet" },
  "en-m1-l03": { photo: require("../../../../../src/content/english/covers/en-m1-l03.webp"), label: "Numbers & time" },
  "en-m1-l04": { photo: require("../../../../../src/content/english/covers/en-m1-l04.webp"), label: "Me & my family" },
  "en-m1-l05": { photo: require("../../../../../src/content/english/covers/en-m1-l05.webp"), label: "School" },
  "en-m1-l06": { photo: require("../../../../../src/content/english/covers/en-m1-l06.webp"), label: "Questions" },
  "en-m1-l07": { photo: require("../../../../../src/content/english/covers/en-m1-l07.webp"), label: "To be & to do" },
  "en-m1-l08": { photo: require("../../../../../src/content/english/covers/en-m1-l08.webp"), label: "Everyday life" },
  "en-m1-l09": { photo: require("../../../../../src/content/english/covers/en-m1-l09.webp"), label: "Reading" },
  "en-m1-l10": { photo: require("../../../../../src/content/english/covers/en-m1-l10.webp"), label: "Study plans" },
  "en-m1-l11": { photo: require("../../../../../src/content/english/covers/en-m1-l11.webp"), label: "Countries & cities" },
  "en-m1-l12": { photo: require("../../../../../src/content/english/covers/en-m1-l12.webp"), label: "Review" },
};
