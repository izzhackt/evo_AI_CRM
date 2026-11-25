// Длинный список карточек с фото (G47): 165 вузов Китая в «Списком», столько же в поиске и «Других вузах», 52 карточки городов.
// Веб грузит картинки лениво (`loading="lazy"`, первые три сразу), а в приложении все они грузились при открытии экрана и
// оставались в памяти. Здесь тот же ScrollView, те же карточки и та же раскладка; меняется одно - далеко от экрана вместо
// картинки стоит подложка той же высоты (`near=false`), и картинка не грузится. Положение прокрутки от этого не зависит.
//
// Как узнаём, что карточка близко: раз в четверть секунды, пока экран открыт, один вызов `measureInWindow` для всего списка
// (не по вызову на карточку), высоты и места карточек приходят из `onLayout`. Если измерение не отвечает - всё открывается
// (подложки навсегда хуже лишней загрузки). Сборка карточек идёт порциями по 24, чтобы 165 карточек не держали поток разом.
// Настоящую выгрузку далёких карточек (FlatList/FlashList вместо ScrollView) без прогона на телефоне делать нельзя: она меняет
// прокрутку (G47, «нужен замер на средненьком Android»).
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { View, useWindowDimensions, type HostInstance, type LayoutChangeEvent } from "react-native";

import { useFocusEffect } from "@/lib/focus";

import { NEAR_EAGER, nearKeys, sameKeys, STAGE_DELAY_MS, STAGE_FIRST, STAGE_STEP, type NearRect } from "./near-window";

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

/** Сколько карточек собрано: первая порция сразу, остальные по одной порции за такт; смена списка (поиск) начинает заново. */
function useStagedCount(total: number, signature: string, first: number, step: number): number {
  const [state, setState] = useState(() => ({ signature, count: Math.min(total, first) }));
  let { count } = state;
  if (state.signature !== signature) {
    // Другой список: сборка начинается с первой порции. Состояние меняется во время отрисовки, пока ключ списка не совпал.
    count = Math.min(total, first);
    setState({ signature, count });
  }
  useEffect(() => {
    if (count >= total) return undefined;
    const id = setTimeout(() => setState((current) => ({ signature: current.signature, count: Math.min(total, current.count + step) })), STAGE_DELAY_MS);
    return () => clearTimeout(id);
  }, [count, total, step]);
  return Math.min(count, total);
}

export function NearList({
  items,
  gap = 12,
  eager = NEAR_EAGER,
  firstBatch = STAGE_FIRST,
  batch = STAGE_STEP,
  measureTop = measureTopInWindow,
  testID,
}: {
  items: readonly NearItem[];
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
  const lastAnswer = useRef(0);
  const [near, setNear] = useState<ReadonlySet<string>>(() => new Set(items.slice(0, eager).map((item) => item.key)));
  const [failOpen, setFailOpen] = useState(false);
  const signature = items.length === 0 ? "" : `${items[0].key}|${items[items.length - 1].key}|${items.length}`;
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
      lastAnswer.current = Date.now();
      const tick = () => {
        const node = box.current;
        if (node === null) return;
        measureTop(node, (top) => {
          if (!alive || top === null) return;
          lastAnswer.current = Date.now();
          setFailOpen(false);
          setNear((previous) => {
            const next = nearKeys({ keys: keys.current, rects: rects.current, boxTop: top, windowHeight, previous, eager });
            return sameKeys(previous, next) ? previous : next;
          });
        });
        // Измерение молчит (нативный сбой): открыть все картинки, а не оставить серые подложки насовсем.
        if (Date.now() - lastAnswer.current > NEAR_FAIL_OPEN_MS) setFailOpen(true);
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
          {item.render(all || near.has(item.key))}
        </View>
      ))}
    </View>
  );
}
