import type { CaseSaleBlock } from "./case-work-view";

/**
 * «Данные продажи» дела прямого студента (290): условия продажи его лида
 * ТОЛЬКО ЧТЕНИЕМ. Дело добавлено поступлением или импортом, продаж у него не
 * было, поэтому форм правки здесь нет: то, что внесено при создании дела
 * (сумма, день продажи), видно в тех же подписях, что у карточки лида.
 * Рисует только заполненное (`caseSaleBlocks`); подзаголовки блоков - когда
 * блоков больше одного. `#sale-conditions` - адрес «Условия продажи» из вкладки
 * «Договор и оплата»: он раскрывает группу, в которой лежит.
 */
export function CaseSaleData({ blocks }: Readonly<{ blocks: readonly CaseSaleBlock[] }>) {
  const titled = blocks.length > 1;
  return (
    <div id="sale-conditions" className="flex min-w-0 scroll-mt-4 flex-col gap-4" data-testid="v3-case-sale-data">
      {blocks.map((block) => (
        <div key={block.key} className="min-w-0" data-testid="v3-case-sale-block">
          {titled ? <h3 className="t-item text-fg">{block.title}</h3> : null}
          <dl className="grid gap-x-8 @2xl:grid-cols-2">
            {block.rows.map((row) => (
              <div key={row.key} className="min-w-0 border-b border-border py-2.5" data-testid="v3-case-sale-row">
                <dt className="t-caption text-fg-2">{row.label}</dt>
                <dd className="mt-0.5 min-w-0 whitespace-pre-wrap break-words t-body-compact text-fg">
                  {row.day ? <time dateTime={row.day} className="font-mono tabular-nums">{row.value}</time> : row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

/** Чтение условий не удалось: группа говорит об этом, а не молчит (как «Задачи» дела). */
export function CaseSaleUnavailable() {
  return (
    <p role="alert" className="t-body-compact text-danger" data-testid="v3-case-sale-unavailable">
      Не удалось прочитать данные продажи. Обновите страницу, чтобы повторить.
    </p>
  );
}
