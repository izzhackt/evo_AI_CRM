/**
 * Часть второй (мелкой) строки очереди: «источник · исход · когда». Разделитель «·» стоит в собственном отступе части;
 * строка сдвинута влево на этот отступ (`-ms-3`) внутри блока с `overflow-hidden`, поэтому у части, которая начинает
 * строку (первой или перенесённой), разделитель уходит за край. Часть переносится целиком, и «·» не остаётся висеть в
 * конце строки или в начале следующей. Общий для «Сегодня» и «Заявок».
 */
export const QUEUE_META_PIECE = "relative flex min-h-6 items-center gap-x-1 ps-3 before:absolute before:start-1 before:top-0 before:flex before:h-6 before:items-center before:text-fg-2 before:content-['·']";
