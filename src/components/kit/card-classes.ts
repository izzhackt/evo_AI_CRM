/**
 * Рамка карточки набора строкой классов — для клиентских кусков прежних экранов (`ProfileDocumentsClient`,
 * `StudentProfileFields`, `CaseMoneySection`), которым в «Новом виде» нужна та же карточка, что у `Card`, но нельзя тянуть в
 * первую загрузку страницы `ui/card` с `cn` и `tailwind-merge`: файл без импортов, как `outline-button.ts`. Тест
 * (`tests/ui-next-card-tabs.test.mjs`) сверяет строки с тем, что рисует `Card`, `CardTitle` и `CardContent`, чтобы они не расходились.
 */
export const CARD_FRAME = "group/card flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card py-4 text-card-foreground";
/** Рамка без вертикального отступа: карточка-раскрытие (`details`), у которой отступ держит сама строка-заголовок. */
export const CARD_FRAME_FLAT = CARD_FRAME.replace(" py-4", "");
export const CARD_TITLE = "t-section min-w-0 text-fg";
export const CARD_BODY = "min-w-0 px-5";
/** Шапка карточки: заголовок слева, действия справа (как `CardHeader` с `CardAction`). */
export const CARD_HEADER = "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5";
