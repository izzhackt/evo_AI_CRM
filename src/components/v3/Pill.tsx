/**
 * Статус-пилюля — единственное место, где в мире V3 есть цвет.
 *
 * Из референса: маленький прямоугольник с бледной подложкой и тёмным текстом
 * своего же оттенка. Всё остальное в интерфейсе почти чёрное или серое, поэтому
 * цветное пятно всегда означает состояние записи и ничего больше.
 *
 * Тон выбирается по смыслу, а не по красоте. Если для значения нет настоящего
 * состояния — берите `neutral`: серая пилюля честнее зелёной, поставленной
 * «чтобы было живее».
 *
 * Текст пилюли на своей подложке: 5.7–6.7:1 — считано, а не подобрано на глаз.
 */

export type PillTone = "neutral" | "ok" | "warn" | "danger" | "info" | "solid";

const TONE: Record<PillTone, string> = {
  neutral: "bg-surface-2 text-fg-2",
  ok: "bg-ok-weak text-ok",
  warn: "bg-warn-weak text-warn",
  danger: "bg-danger-weak text-danger",
  info: "bg-info-weak text-info",
  /** Для одного самого важного состояния на экране. Почти чёрная. */
  solid: "bg-accent text-on-accent",
};

export function Pill({
  tone = "neutral",
  children,
}: {
  tone?: PillTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[5px] px-1.5 py-0.5 text-2xs font-medium leading-4 ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
