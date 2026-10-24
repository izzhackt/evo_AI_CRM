import { QUEUE_CONFIRM, QUEUE_SECONDARY } from "@/components/v3/queue/queue-buttons";

/**
 * Кнопки очереди на `<a>`: у них `enabled:hover:` не срабатывает (ссылка не бывает `:enabled`),
 * поэтому наведение дописано явно. Общие классы не тронуты — это локальная добавка до общей правки.
 */
export const AIA_LINK_SECONDARY = `${QUEUE_SECONDARY} hover:bg-surface-2 hover:text-fg`;
export const AIA_LINK_CONFIRM = `${QUEUE_CONFIRM} hover:border-fg-2 hover:bg-fg-2`;

/**
 * Главное действие страницы агента («Сохранить», «Сохранить настройки») — единственная
 * сплошная красная кнопка на странице. Размер и шрифт те же, что у кнопок очереди
 * (`QUEUE_CONFIRM`, `QUEUE_SECONDARY`), а недоступное состояние — токены поверхности,
 * без прозрачности (общий `btnCls` теперь тоже так; здесь остаётся `min-h-11` и `enabled:hover:`
 * без анимации нажатия). Подтверждения, повторы и «Отмена» — кнопки очереди.
 */
export const AIA_PRIMARY =
  "v3-raised inline-flex min-h-11 items-center justify-center gap-1.5 rounded-ctl border border-accent bg-accent px-4 t-label text-on-accent enabled:hover:border-accent-2 enabled:hover:bg-accent-2 disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-fg-3";

/**
 * Панель действий формы, пока есть несохранённые правки: прилипает к нижнему краю, и «Сохранить» не прячется за экраном.
 * На телефоне над нижней панелью вкладок (она `fixed`), как `.v3-bulk-dock`: иначе панель уезжает под неё.
 */
export const AIA_STICKY_BAR = "sticky bottom-[calc(var(--shell-tabbar,0px)+var(--shell-safe-bottom,0px))] z-10 -mx-1 flex flex-wrap items-center gap-3 border-t border-border bg-bg px-1 py-3";

/** Без правок панель стоит в конце формы и ничего не закрывает. */
export const AIA_STATIC_BAR = "flex flex-wrap items-center gap-3 py-1";
