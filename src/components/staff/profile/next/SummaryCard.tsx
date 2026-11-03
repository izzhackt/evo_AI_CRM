import { KeyFacts, type KeyFact } from "@/components/kit/KeyFacts";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Сводка карточки лида и дела: вверху этап, «Что дальше» и состояние, под волосяной линией - не больше четырёх
 * ключевых данных (`KeyFacts`). Имя - заголовок страницы, действия - в её шапке; здесь только то, ради чего
 * открывают карточку. Факты без значения не рисуются, и линия вместе с ними.
 */
export function SummaryCard({
  facts,
  testId,
  children,
}: Readonly<{
  facts: readonly KeyFact[];
  testId?: string;
  children: React.ReactNode;
}>) {
  const hasFacts = facts.some((fact) => fact.value !== null && fact.value !== undefined && fact.value !== "");
  return (
    <Card data-testid={testId} className="gap-0 py-0">
      <CardContent className="py-4">{children}</CardContent>
      {hasFacts ? (
        <CardContent className="border-t border-border py-4">
          <KeyFacts facts={facts} columns={4} />
        </CardContent>
      ) : null}
    </Card>
  );
}

/** Ячейка ряда сводки: подпись данных над значением; соседей разделяет волосяная линия (как у шапки дела). */
export function SummaryCell({ term, wide = false, children }: Readonly<{ term: string; wide?: boolean; children: React.ReactNode }>) {
  return (
    <div className={`min-w-0 border-border py-2 sm:border-s sm:px-4 sm:first:border-s-0 sm:first:ps-0 ${wide ? "sm:min-w-[16rem] sm:flex-1" : ""}`}>
      <dt className="t-caption text-fg-3">{term}</dt>
      <dd className="mt-0.5 min-w-0 t-body-compact text-fg">{children}</dd>
    </div>
  );
}
