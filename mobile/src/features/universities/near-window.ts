// Окно прокрутки длинных списков (G47): какие карточки «близки к экрану». Чистые функции, без React Native.
//
// Список остаётся обычным: карточки лежат в том же ScrollView, что и прежде, ни одна не удаляется и не меняет размер. Окно
// решает одно: грузить ли картинку карточки сейчас. Вдали от экрана вместо неё ровная подложка той же высоты, поэтому
// раскладка и положение прокрутки не меняются (веб: `loading="lazy"`, первые три карточки сразу - UniversityTile.tsx).

/** Место карточки в списке: смещение от верха списка и высота. */
export type NearRect = Readonly<{ y: number; h: number }>;

/** Сколько экранов выше и ниже видимого считается «близко» (картинка уже грузится). */
export const NEAR_MARGIN_SCREENS = 1;
/** Пока картинка не вышла за это число экранов, она не выгружается: на границе окна карточки не мигают. */
export const FAR_MARGIN_SCREENS = 2;
/** Первые карточки списка всегда с картинкой (веб: первые три - `priority`). */
export const NEAR_EAGER = 6;

/**
 * Ключи близких карточек. Близка та, что среди первых `eager` либо пересекает окно `[-margin, высота окна + margin]`; уже
 * близкая остаётся, пока пересекает более широкое окно (`farMargin`): так карточка на границе не загружается и выгружается
 * по кругу. Карточка, чьё место ещё не измерено, не близка (измерение придёт следующим тактом).
 *
 * @param boxTop расстояние от верха окна до верха списка (`measureInWindow`); отрицательное, если список прокручен вверх.
 */
export function nearKeys({
  keys,
  rects,
  boxTop,
  windowHeight,
  previous,
  eager = NEAR_EAGER,
  margin = NEAR_MARGIN_SCREENS,
  farMargin = FAR_MARGIN_SCREENS,
}: {
  keys: readonly string[];
  rects: ReadonlyMap<string, NearRect>;
  boxTop: number;
  windowHeight: number;
  previous: ReadonlySet<string>;
  eager?: number;
  margin?: number;
  farMargin?: number;
}): ReadonlySet<string> {
  const near = new Set<string>();
  const inside = (rect: NearRect, screens: number) => {
    const top = boxTop + rect.y;
    return top + rect.h >= -screens * windowHeight && top <= windowHeight + screens * windowHeight;
  };
  keys.forEach((key, index) => {
    if (index < eager) {
      near.add(key);
      return;
    }
    const rect = rects.get(key);
    if (rect === undefined) return;
    if (inside(rect, margin) || (previous.has(key) && inside(rect, farMargin))) near.add(key);
  });
  return near;
}

export function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}
