/**
 * Кнопки «Бланков университета»: те же роли, что у справочников и очереди
 * (волосяная тень, `t-label`, 44 px). Обычный модуль без React: компоненты
 * форм собирает и тест без сборщика.
 *
 * Сплошной красный — главное действие шага (создать, загрузить, сохранить
 * настройку, подтвердить решение); архив и возвраты — спокойные.
 */
export { QUEUE_SECONDARY as FORM_SECONDARY } from "../../queue/queue-buttons";

export const FORM_PRIMARY = "v3-raised inline-flex min-h-11 items-center justify-center gap-1.5 rounded-ctl border border-accent bg-accent px-4 t-label text-on-accent hover:border-accent-2 hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50";
