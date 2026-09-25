/**
 * Кнопки очереди. Сплошной красный остаётся одному главному действию страницы
 * («Создать задачу» в верхней панели), поэтому подтверждение в строке и в
 * панели — тёмная нейтральная кнопка, как «Подтвердить замещение» на
 * «Студентах». Недоступное состояние — токены поверхности, без opacity.
 */
const DISABLED = "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-2 disabled:text-fg-3";

export const QUEUE_CONFIRM = `v3-raised inline-flex min-h-11 items-center justify-center gap-1.5 rounded-ctl border border-fg bg-fg px-4 t-label text-surface enabled:hover:border-fg-2 enabled:hover:bg-fg-2 ${DISABLED}`;

export const QUEUE_SECONDARY = `v3-raised inline-flex min-h-11 items-center justify-center gap-1.5 rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 enabled:hover:bg-surface-2 enabled:hover:text-fg ${DISABLED}`;

/** Поле ввода в строке очереди и в панели (16 px — без увеличения на iPhone). */
export const QUEUE_FIELD = "mt-1 block h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface px-3 t-body text-fg placeholder:text-fg-3 focus-visible:border-accent disabled:bg-surface-2 disabled:text-fg-3";
