// Поэтапная сборка длинного списка (G47): 165 карточек вузов Китая или 270 программ вуза не должны держать поток одним куском.
// Первая порция появляется сразу, остальные по одной порции за такт; смена списка (поиск, фильтр) начинает заново. Те же
// карточки в том же ScrollView: меняется только то, сколько их собрано в данный момент, прокрутка и раскладка прежние.
import { useEffect, useState } from "react";

/** Размеры порций и пауза между ними (мс): кадр успевает отрисоваться, касание не ждёт всей сборки. */
export const STAGE_FIRST = 24;
export const STAGE_STEP = 24;
export const STAGE_DELAY_MS = 32;

/**
 * Сколько элементов списка собрано. `signature` - ключ списка (первый и последний элемент и длина): другой ключ - сборка с первой
 * порции. Меньше `first` элементов собираются целиком сразу, таймеров нет.
 */
export function useStagedCount(total: number, signature: string, first: number = STAGE_FIRST, step: number = STAGE_STEP): number {
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
