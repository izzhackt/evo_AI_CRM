// Оттенок цвета токена для фонов вердиктов и подсказок (веб: `color-mix(in srgb, var(--pt-ok) 9%, var(--pt-surface))` в csca.css).
// Токены темы это `#rrggbb`: к цвету дописывается непрозрачность, фон под ним остаётся поверхностью карточки. Всё, что не
// `#rrggbb`, оттенка не получает (прозрачный фон лучше, чем сплошной цвет поверх текста).
const HEX = /^#[0-9a-f]{6}$/iu;

export function tint(color: string, percent: number): string {
  if (!HEX.test(color)) return "transparent";
  const alpha = Math.round((Math.min(100, Math.max(0, percent)) / 100) * 255);
  return `${color}${alpha.toString(16).padStart(2, "0")}`;
}
