// Блок сбоя в тесте («Не удалось подтвердить сохранение», «Повторить сохранение», «Выйти без сохранения») стоит наверху страницы, а
// «Сохранить и выйти» и «Завершить» внизу: студент долистал до кнопки, нажал, и ответ оказывается выше видимой части, на экране
// «ничего не происходит» (QA 24, N2). Блок прокручивается в видимую часть, когда он появился или к нему прибавилась причина и когда
// студент нажал выход или «Завершить» и получил отказ. Один раз на такое событие (круги повтора страницу не двигают) и только если
// верх блока выше видимой части: кто уже смотрит на блок, не сдвигается.
import { useCallback, useMemo, useRef, type RefObject } from "react";
import type { LayoutChangeEvent } from "react-native";

import type { ScrollTarget } from "@/ui/Screen";

/** Запас над блоком после прокрутки: блок не прижат к шапке. */
export const REVEAL_MARGIN = 12;

export type PageScroll = Readonly<{
  /** Куда сейчас прокручена страница; отдаётся странице (`onScrollY` у `StackPage` и `RunnerPage`). */
  onScrollY: (y: number) => void;
  /** К началу страницы (смена стадии теста, новая страница вопросов). */
  toTop: () => void;
  /** Показать блок, верх которого лежит на `top` от начала содержимого: прокрутка идёт, только если верх выше видимой части. */
  reveal: (top: number) => void;
}>;

/**
 * Положение прокрутки страницы и две команды ей. Положение хранится в ссылке (прокрутка не перерисовывает экран) и меняется
 * сразу после собственной команды, не дожидаясь события прокрутки: следующий вопрос «видно ли блок» уже знает, где страница.
 */
export function usePageScroll(scrollRef: RefObject<ScrollTarget | null>): PageScroll {
  const offset = useRef(0);
  const onScrollY = useCallback((y: number) => {
    offset.current = y;
  }, []);
  const toTop = useCallback(() => {
    offset.current = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [scrollRef]);
  const reveal = useCallback(
    (top: number) => {
      if (top >= offset.current) return; // верх блока в видимой части или ниже: студент его видит
      const y = Math.max(0, top - REVEAL_MARGIN);
      offset.current = y;
      scrollRef.current?.scrollTo({ y, animated: false });
    },
    [scrollRef],
  );
  return useMemo(() => ({ onScrollY, toTop, reveal }), [onScrollY, toTop, reveal]);
}

/**
 * Где блок лежит на странице: верх раннера в содержимом (`onRootLayout`) и верх блока в раннере (`onBlockLayout`); телефон сообщает
 * их событием раскладки. `show()` просит показать блок: если его раскладка ещё неизвестна (блок только что появился), показ ждёт её.
 * `hide()` вызывается, когда блока больше нет: его прежнее положение устарело.
 */
export function useRevealBlock(page: Pick<PageScroll, "reveal">) {
  const { reveal } = page;
  const rootTop = useRef(0);
  const blockTop = useRef<number | null>(null);
  const waiting = useRef(false);
  const onRootLayout = useCallback((event: LayoutChangeEvent) => {
    rootTop.current = event.nativeEvent.layout.y;
  }, []);
  const onBlockLayout = useCallback(
    (event: LayoutChangeEvent) => {
      blockTop.current = event.nativeEvent.layout.y;
      if (!waiting.current) return;
      waiting.current = false;
      reveal(rootTop.current + blockTop.current);
    },
    [reveal],
  );
  const show = useCallback(() => {
    if (blockTop.current === null) {
      waiting.current = true;
      return;
    }
    reveal(rootTop.current + blockTop.current);
  }, [reveal]);
  const hide = useCallback(() => {
    blockTop.current = null;
    waiting.current = false;
  }, []);
  return useMemo(() => ({ onRootLayout, onBlockLayout, show, hide }), [onRootLayout, onBlockLayout, show, hide]);
}
