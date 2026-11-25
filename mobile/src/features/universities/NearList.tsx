// Длинный список карточек с фото (G47): 165 вузов Китая в «Списком», столько же в поиске и «Других вузах», 52 карточки городов.
// Веб грузит картинки лениво (`loading="lazy"`, первые три сразу), а в приложении все они грузились при открытии экрана и
// оставались в памяти. Здесь тот же ScrollView, те же карточки и та же раскладка; меняется одно - далеко от экрана вместо
// картинки стоит подложка той же высоты (`near=false`), и картинка не грузится. Положение прокрутки от этого не зависит.
//
// Как узнаём, что карточка близко: раз в четверть секунды, пока экран открыт, один вызов `measureInWindow` для всего списка
// (не по вызову на карточку), высоты и места карточек приходят из `onLayout`. Если измерение не отвечает - всё открывается
// (подложки навсегда хуже лишней загрузки); молчание считается тактами, а не по часам: после фона таймер стоит, а часы идут, и по
// часам первый же такт решил бы, что измерение молчит давно. Первые карточки всегда с картинкой при любом списке: правило
// применяется при отрисовке, а не только к первому списку. Сборка карточек идёт порциями по 24, чтобы 165 карточек не
// держали поток разом.
// Настоящую выгрузку далёких карточек (FlatList/FlashList вместо ScrollView) без прогона на телефоне делать нельзя: она меняет
// прокрутку (G47, «нужен замер на средненьком Android»).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { View, useWindowDimensions, type HostInstance, type LayoutChangeEvent } from "react-native";

import { useFocusEffect } from "@/lib/focus";

import { NEAR_EAGER, nearKeys, sameKeys, type NearRect } from "./near-window";
import { STAGE_FIRST, STAGE_STEP, useStagedCount } from "./staged";

export type NearItem = Readonly<{
  key: string;
  /** Что нарисовать; `near` - можно ли грузить картинку карточки. */
  render: (near: boolean) => ReactNode;
  /** Отступ сверху до этой карточки; по умолчанию `gap` списка. */
  spaceBefore?: number;
}>;

/** Расстояние от верха окна до верха вида; `null` - измерить не удалось. */
export type MeasureTop = (node: HostInstance, done: (top: number | null) => void) => void;

export const measureTopInWindow: MeasureTop = (node, done) => {
  try {
    node.measureInWindow((_x, y, width, height) => done(Number.isFinite(y) && (width > 0 || height > 0) ? y : null));
  } catch {
    done(null);
  }
};

/** Как часто спрашивать, где список (мс), и через сколько без ответа открыть все картинки. */
export const NEAR_POLL_MS = 250;
export const NEAR_FAIL_OPEN_MS = 2500;

export function NearList({
  items,
  listKey,
  gap = 12,
  eager = NEAR_EAGER,
  firstBatch = STAGE_FIRST,
  batch = STAGE_STEP,
  measureTop = measureTopInWindow,
  testID,
}: {
  items: readonly NearItem[];
  /**
   * Какой это список: поиск, вид, город. Сборка начинается заново, только когда он меняется. Без него список узнаётся по первому и
   * последнему ключу и числу карточек, и фоновое обновление каталога (новый вуз в середине) сбросило бы собранные карточки к первой
   * порции: содержимое сжалось бы, а прокрутка уехала. Экраны с живыми данными задают его сами.
   */
  listKey?: string;
  gap?: number;
  eager?: number;
  firstBatch?: number;
  batch?: number;
  measureTop?: MeasureTop;
  testID?: string;
}) {
  const { height: windowHeight } = useWindowDimensions();
  const box = useRef<HostInstance>(null);
  const rects = useRef(new Map<string, NearRect>());
  const keys = useRef<readonly string[]>([]);
  /** Сколько тактов подряд измерение не отвечало. */
  const silent = useRef(0);
  const [near, setNear] = useState<ReadonlySet<string>>(() => new Set(items.slice(0, eager).map((item) => item.key)));
  const [failOpen, setFailOpen] = useState(false);
  const signature = listKey ?? (items.length === 0 ? "" : `${items[0].key}|${items[items.length - 1].key}|${items.length}`);
  const count = useStagedCount(items.length, signature, firstBatch, batch);
  const shown = items.slice(0, count);
  useEffect(() => {
    keys.current = shown.map((item) => item.key);
  });
  // Первые `eager` карточек всегда с картинкой; короткому списку окно не нужно.
  const watching = items.length > eager;

  useFocusEffect(
    useCallback(() => {
      if (!watching) return undefined;
      let alive = true;
      silent.current = 0;
      const tick = () => {
        const node = box.current;
        if (node === null) return;
        measureTop(node, (top) => {
          if (!alive || top === null) return;
          silent.current = 0;
          setFailOpen(false);
          setNear((previous) => {
            const next = nearKeys({ keys: keys.current, rects: rects.current, boxTop: top, windowHeight, previous, eager });
            return sameKeys(previous, next) ? previous : next;
          });
        });
        // Измерение молчит (нативный сбой): открыть все картинки, а не оставить серые подложки насовсем.
        if (silent.current * NEAR_POLL_MS > NEAR_FAIL_OPEN_MS) setFailOpen(true);
        silent.current += 1;
      };
      tick();
      const id = setInterval(tick, NEAR_POLL_MS);
      return () => {
        alive = false;
        clearInterval(id);
      };
    }, [watching, measureTop, windowHeight, eager]),
  );

  const layout = (key: string, event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    rects.current.set(key, { y, h: height });
  };
  const all = failOpen || !watching;
  return (
    <View ref={box} collapsable={false} testID={testID}>
      {shown.map((item, index) => (
        <View key={item.key} onLayout={(event) => layout(item.key, event)} style={index === 0 ? undefined : { marginTop: item.spaceBefore ?? gap }} testID={testID ? `${testID}:${item.key}` : undefined}>
          {item.render(all || index < eager || near.has(item.key))}
        </View>
      ))}
    </View>
  );
}
