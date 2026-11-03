/**
 * Подтверждение в «Новом виде»: тёмная кнопка (`QUEUE_CONFIRM` прежнего вида), поверх `Button` набора. Сплошной
 * красный остаётся одному главному действию страницы; подтверждения в окнах и строках — тёмные.
 */
export const CONFIRM_CLASS = "border-fg bg-fg text-surface hover:border-fg-2 hover:bg-fg-2";

/** Панель действий формы, пока есть несохранённые правки: прилипает к нижнему краю над нижней панелью вкладок телефона. */
export const STICKY_BAR = "sticky bottom-[calc(var(--shell-tabbar,0px)+var(--shell-safe-bottom,0px))] z-10 -mx-1 flex flex-wrap items-center gap-3 border-t border-border bg-bg px-1 py-3";

/** Без правок панель стоит в конце формы и ничего не закрывает. */
export const STATIC_BAR = "flex flex-wrap items-center gap-3 py-1";
