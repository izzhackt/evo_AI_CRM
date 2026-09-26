import { personInitials } from "../queue/person-name";

/**
 * Инициалы нового облика (Э1.3): нейтральный круг, без своего цвета у
 * человека — цвет не различает людей и ничего не значит. Полное имя — в
 * подсказке и для читалки. `decorative` — имя уже написано рядом: круг —
 * только рисунок и скрыт от читалки, подсказки нет.
 */
export function Initials({
  name,
  decorative = false,
  size,
}: Readonly<{
  name: string;
  decorative?: boolean;
  /** `sm` — 20 px в строке карточки доски: круг не поднимает высоту строки (v3.css). */
  size?: "sm";
}>) {
  const full = name.trim();
  const letters = personInitials(full);
  if (!letters) return null;
  if (decorative) {
    return <span className="v3-initials t-caption" data-size={size} aria-hidden="true">{letters}</span>;
  }
  return (
    <span className="v3-initials t-caption" data-size={size} title={full}>
      <span aria-hidden="true">{letters}</span>
      <span className="sr-only">{full}</span>
    </span>
  );
}
