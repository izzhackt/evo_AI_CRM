/** Вид кнопки «?» и свойства `HelpTip`: общие для настоящего «?» (`HelpTipImpl`) и заглушки на время загрузки (`HelpTip`). */
export const HELP_TIP_BUTTON =
  "relative inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-input bg-surface t-caption text-fg-2 transition-colors after:absolute after:-inset-2.5 hover:bg-surface-2 hover:text-fg aria-expanded:bg-surface-2 aria-expanded:text-fg motion-reduce:transition-none";

export type HelpTipProps = Readonly<{
  children: React.ReactNode;
  /** Имя кнопки для читалки; у хозяина с заголовком — «Пояснение: <заголовок>». */
  label?: string;
  align?: "start" | "center" | "end";
  className?: string;
}>;
