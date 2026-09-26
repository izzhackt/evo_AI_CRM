import type { DueWordView } from "../queue/due-bucket";

/**
 * Срок словом нового облика (Э1.3): «прошёл 3 дн» — красный текст (проблема),
 * «сегодня» — маленькая красная заливка с белым текстом (правило плана:
 * сплошной красный — главное действие и «сегодня»), «завтра», «через 2 дн» —
 * нейтрально. Слово есть всегда: смысл не держится на одном цвете. Дата стоит
 * рядом своим `<time>` у вызывающего; слово считает `dueWordOf`.
 */
export function DueWord({ view, className }: Readonly<{ view: DueWordView | null; className?: string }>) {
  if (!view) return null;
  return (
    <span className={className ? `v3-due t-caption ${className}` : "v3-due t-caption"} data-due={view.tone}>
      {view.text}
    </span>
  );
}
