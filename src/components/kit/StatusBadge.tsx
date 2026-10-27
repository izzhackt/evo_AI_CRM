import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Названия тонов — те же, что у `StatusChip` и `Pill` (src/components/v3): значения состояний переносятся как есть. */
export type StatusTone = "neutral" | "ok" | "warn" | "danger" | "info";

/**
 * Состояние словом. Слово обязательно, цвет его только подкрепляет; пустое слово — чипа нет. Красный
 * (`danger`) — только проблема; нет настоящего состояния — `neutral`.
 */
export function StatusBadge({
  label,
  tone = "neutral",
  title,
  wrap = false,
  className,
}: Readonly<{
  label: string;
  tone?: StatusTone;
  title?: string;
  /** Слово не помещается в узкую ячейку: переносится на вторую строку, а не выходит за столбец. */
  wrap?: boolean;
  className?: string;
}>) {
  const word = label.trim();
  if (!word) return null;
  return (
    <Badge variant={tone} title={title} className={cn(wrap && "whitespace-normal rounded-[10px] text-balance", className)}>
      {word}
    </Badge>
  );
}
