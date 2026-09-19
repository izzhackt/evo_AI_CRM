import type { PortalStatusTone } from "./presentation";

/**
 * Статус-пилюля Атласа (PORT-5d): честный доменный статус, цвет — вторичный
 * канал (текст всегда несёт смысл сам). Неизвестное значение по-прежнему
 * даёт честную подпись «статус недоступен» — теперь её (локализованную)
 * подставляют presentation-функции через ключ admission.statusUnavailable,
 * поэтому сюда приходит уже готовая строка (PORT-6a).
 */
export function PortalStatus({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: PortalStatusTone;
}) {
  return (
    <span className={`pt-status pt-status-${tone}`}>
      {label}
    </span>
  );
}
