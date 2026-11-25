// Фото профессии по ключу карточки каталога (веб: `ProfessionPhoto`): одно и то же в каталоге, в «Подходят вам», в шапке страницы
// профессии и в итоге Эви. Картинка - украшение (название рядом), поэтому для читалки её нет; нет файла - ничего не рисуется (как в
// вебе). Файлы - ресурсы сборки (`photos.ts`), а не адреса в сети: загрузки, ожидания и «не загрузилось» у них нет.
import { Image } from "expo-image";

import { PROFESSION_PHOTOS, type ProfessionPhotoSource } from "@/features/learning/professions/photos";
import { useTheme } from "@/theme/ThemeProvider";

/** Снимок профессии или `null`: по нему вызывающий решает, рисовать ли подложку и номер (итог Эви) или отступы (карточки каталога). */
export function professionPhotoSource(cardKey: string): ProfessionPhotoSource | null {
  return PROFESSION_PHOTOS[cardKey] ?? null;
}

/** 16:9 по ширине родителя; `radius` - скругление, когда родитель не обрезает углы сам. `eager` - шапка страницы: видна сразу. */
export function ProfessionPhoto({ cardKey, radius = 0, eager = false, testID }: Readonly<{ cardKey: string; radius?: number; eager?: boolean; testID?: string }>) {
  const { tokens } = useTheme();
  const source = professionPhotoSource(cardKey);
  if (source === null) return null;
  return (
    <Image
      source={source}
      contentFit="cover"
      transition={eager ? 0 : 150}
      priority={eager ? "high" : "normal"}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      accessibilityIgnoresInvertColors
      testID={testID ?? `profession-photo-${cardKey}`}
      style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius, backgroundColor: tokens.skeleton }}
    />
  );
}
