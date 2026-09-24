"use client";

import Link from "next/link";

import { Icon } from "@/components/icons";

import { useAnchoredPopover } from "./useAnchoredPopover";

export type FilterOption = Readonly<{ key: string; label: string; href: string; selected: boolean }>;

/** Кнопка фильтра строки инструментов: 44 px, нейтральная; выбранное значение — внутри. */
export const FILTER_BUTTON =
  "inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-ctl border border-control-edge bg-surface ps-3 pe-2 t-label text-fg-2 hover:bg-surface-2 hover:text-fg";

/**
 * Выпадающий фильтр очереди: «Тип ▾», а после выбора — «Тип: По студентам ×».
 * Варианты — настоящие ссылки (фильтр живёт в адресе), выбранный отмечен
 * `aria-current` и общим `.v3-choice`. Окно — popover API в верхнем слое:
 * открывается и без скрипта, закрывается Esc, щелчком мимо и выбором: страница
 * при смене адреса не пересоздаётся, и само окно открытым не останется.
 */
export function FilterMenu({
  label,
  valueLabel,
  options,
  clearHref = null,
}: Readonly<{
  /** Название фильтра: «Тип», «Срок». */
  label: string;
  /** Выбранное значение, если оно не по умолчанию; null — показывается только название. */
  valueLabel: string | null;
  options: readonly FilterOption[];
  /** Ссылка «убрать фильтр» для × рядом с выбранным значением. */
  clearHref?: string | null;
}>) {
  const { popoverId, triggerId, triggerStyle, popoverStyle } = useAnchoredPopover();
  return (
    <div className="inline-flex min-w-0 max-w-full items-stretch">
      <button
        id={triggerId}
        type="button"
        popoverTarget={popoverId}
        style={triggerStyle}
        className={`${FILTER_BUTTON} ${valueLabel && clearHref ? "rounded-e-none border-e-0" : ""}`}
      >
        {valueLabel ? (
          <span className="min-w-0 truncate">{label}: <span className="text-fg">{valueLabel}</span></span>
        ) : <span>{label}</span>}
        <Icon name="chevron-down" size={16} className="shrink-0 text-fg-3" />
      </button>
      {valueLabel && clearHref ? (
        <Link
          href={clearHref}
          scroll={false}
          aria-label={`Убрать фильтр: ${label}: ${valueLabel}`}
          className="inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-e-[8px] border border-control-edge bg-surface text-fg-3 hover:bg-surface-2 hover:text-fg"
        >
          <Icon name="x" size={16} />
        </Link>
      ) : null}
      <div
        id={popoverId}
        popover="auto"
        style={popoverStyle}
        role="group"
        aria-label={label}
        className="v3-anchored min-w-48 max-w-[min(20rem,calc(100vw-1rem))] rounded-ctl border border-border bg-surface p-1 text-fg shadow-evo-lg"
      >
        <ul>
          {options.map((option) => (
            <li key={option.key}>
              <Link
                href={option.href}
                scroll={false}
                aria-current={option.selected ? "true" : undefined}
                onClick={() => document.getElementById(popoverId)?.hidePopover()}
                className="v3-choice flex min-h-11 items-center gap-2 rounded-nav px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg"
              >
                <span className="min-w-0 flex-1">{option.label}</span>
                {option.selected ? <Icon name="check" size={16} className="shrink-0" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
