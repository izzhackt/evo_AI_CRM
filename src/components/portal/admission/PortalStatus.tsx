import type { PortalStatusTone } from "./presentation";

/**
 * Статус-пилюля Атласа (PORT-5d): честный доменный статус, цвет — вторичный
 * канал (текст всегда несёт смысл сам). Тон «неизвестного» значения — как и
 * раньше — честная подпись «статус недоступен», не пустота.
 */
export function PortalStatus({
  label,
  tone = "neutral",
}: {
  label: string | null;
  tone?: PortalStatusTone;
}) {
  return (
    <span className={`pt-status pt-status-${tone}`}>
      {label ?? "статус недоступен"}
    </span>
  );
}
