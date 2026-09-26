import type { ReactNode } from "react";

import { progressOf } from "./progress";

/**
 * Полоса прогресса нового облика (Э1.3): подпись «N из M …» словами и тонкая
 * полоса под ней. Смысл несёт подпись; полоса — её рисунок и для читалки
 * скрыта. Без настоящих чисел (`progressOf` → null) полосы нет: рисуется
 * `fallback` — строка, которую показал бы прежний облик («Чек-лист не собран»
 * или прочитанные числа, которые не сходятся), — или ничего.
 * Заполнение меняется за 200 мс; при `prefers-reduced-motion` — сразу (v3.css).
 */
export function ProgressBar({
  done,
  total,
  word,
  className,
  fallback = null,
}: Readonly<{
  done: number | null | undefined;
  total: number | null | undefined;
  /** Слово после числа: «принято». */
  word?: string;
  className?: string;
  /** Что показать без полосы: строка прежнего облика. */
  fallback?: ReactNode;
}>) {
  const progress = progressOf(done, total, word);
  if (!progress) return fallback;
  return (
    <span className={className ? `v3-progress ${className}` : "v3-progress"} data-progress={`${progress.done}/${progress.total}`}>
      <span className="t-body-compact text-fg">{progress.label}</span>
      <span className="v3-progress-track" aria-hidden="true">
        <span className="v3-progress-fill" style={{ width: `${progress.percent}%` }} />
      </span>
    </span>
  );
}
