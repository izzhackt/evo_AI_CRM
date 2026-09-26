import type { StagePhase } from "@/lib/v3/stages";

/**
 * Чипы нового облика (Э1.3–Э1.4 плана редизайна).
 *
 * `StatusChip` — состояние словом: слово обязательно, цвет его только
 * подкрепляет (красный — только проблема, `--danger`). Пустое слово — чипа
 * нет: цвет без слова ничего не значит.
 *
 * `StageChip` — этап словом доски и точкой цвета своей фазы («Продажи»,
 * «Поступление», «Виза и выезд»). Цвет фазы есть только у чипа и дорожки
 * этапа; точка — рисунок, для читалки это слово этапа. Слово переносится,
 * а не обрезается: в словаре этапов нет обрезанных слов.
 */
export type StatusChipTone = "neutral" | "ok" | "warn" | "danger" | "info";

export function StatusChip({
  label,
  tone = "neutral",
  title,
  size,
}: Readonly<{
  label: string;
  tone?: StatusChipTone;
  title?: string;
  /** `sm` — строка карточки доски: чип 18 px не раздвигает строку 16 px (карточка — до 72 px). */
  size?: "sm";
}>) {
  const word = label.trim();
  if (!word) return null;
  return (
    <span className="v3-chip t-caption" data-tone={tone} data-size={size} title={title}>
      {word}
    </span>
  );
}

export function StageChip({
  label,
  phase,
  className,
  truncate = false,
}: Readonly<{
  label: string | null;
  phase: StagePhase | null;
  className?: string;
  /** Заголовок колонки доски в одну строку: слово сокращается многоточием, полное — в подсказке колонки. */
  truncate?: boolean;
}>) {
  const word = label?.trim();
  if (!word) return null;
  return (
    <span className={className ? `v3-stage ${className}` : "v3-stage"} data-phase={phase ?? undefined}>
      {phase ? <span className="v3-phase-dot" aria-hidden="true" /> : null}
      <span className={truncate ? "min-w-0 truncate" : "min-w-0"}>{word}</span>
    </span>
  );
}
