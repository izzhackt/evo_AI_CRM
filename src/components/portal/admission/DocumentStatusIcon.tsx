import type { DocumentChecklistIcon } from "./presentation";

/**
 * Значок строки документа (03.11.2026): лист — нужно добавить, часы — на
 * проверке, галочка — принят, восклицательный знак — исправить. Тот же штрих
 * 1.5 на сетке 20×20, что у иконок меню; смысл несёт слово статуса рядом.
 */
const PATHS: Readonly<Record<DocumentChecklistIcon, string>> = {
  file: "M6 2.5h5.5L15 6v11.5H6zM11.5 2.5V6H15M8.2 10h3.6M8.2 13h3.6",
  clock: "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6.5V10l2.3 1.6",
  check: "M5.5 10.4 8.6 13.4 14.5 7",
  alert: "M10 5.5v5.5M10 14.3v.2",
};

export function DocumentStatusIcon({ icon, className }: Readonly<{ icon: DocumentChecklistIcon; className: string }>) {
  return (
    <span className={className} data-icon={icon} aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
        <path d={PATHS[icon]} stroke="currentColor" strokeWidth={icon === "alert" ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
