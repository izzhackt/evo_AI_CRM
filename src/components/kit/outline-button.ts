/**
 * Вид кнопки набора: ровно те классы, что даёт `<Button variant="outline" className="w-fit">`. Заглушки ленивых кусков
 * («Ещё N» на время загрузки панели, `LoadFailed`) берут их отсюда и не тянут склейку классов (`cva`, `tailwind-merge`) в первую
 * загрузку страницы; тест сверяет строку с `buttonVariants`, чтобы заглушка и настоящая кнопка не расходились (цвет, тень, промежуток).
 */
export const OUTLINE_BUTTON =
  "inline-flex h-11 min-w-11 shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl border px-4 t-label transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-fg-3 disabled:active:scale-100 aria-invalid:border-danger motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px] v3-raised border-input bg-surface text-fg-2 hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg w-fit";
