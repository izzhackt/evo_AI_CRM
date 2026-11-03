import { StatTile } from "@/components/kit";

import type { StudentTile } from "./students-next-model";

/**
 * Плитки сроков «Следующего шага» вместо заголовков групп: число каждой непустой группы из чтения чисел. Красным — только
 * число просроченного. Телефон — две колонки (как показатели ИИ-агентов), от `md` — сетка по числу плиток.
 */
export function StudentTiles({ tiles }: Readonly<{ tiles: readonly StudentTile[] }>) {
  if (tiles.length === 0) return null;
  return (
    <div role="group" aria-label="Числа по срокам шага" data-testid="students-tiles" className="grid grid-cols-2 gap-3 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
      {tiles.map((tile) => <StatTile key={tile.key} label={tile.label} value={tile.value} tone={tile.tone} />)}
    </div>
  );
}
