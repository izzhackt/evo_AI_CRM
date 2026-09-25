import Link from "next/link";
import type { ReactNode } from "react";

import { Icon } from "@/components/icons";

import { QueueFilterDisclosure } from "./QueueFilterDisclosure";
import { QueueKeyboardHelp, type QueueKey } from "./QueueKeyboardHelp";

/** Поле поиска очереди: «/» переводит в него фокус (`useQueueKeyboard`). */
export const QUEUE_SEARCH_SELECTOR = "[data-queue-search]";

export type QueueSearch = Readonly<{
  /** Адрес страницы: поиск отправляется обычной формой GET. */
  action: string;
  name: string;
  defaultValue: string;
  placeholder: string;
  /** Доступное имя поля. */
  label: string;
  /** Остальные параметры адреса, которые поиск сохраняет. */
  hidden: Readonly<Record<string, string | null>>;
}>;

/**
 * Одна строка инструментов очереди: поиск (Enter), выпадающие фильтры со
 * значением внутри, «Сбросить» — только когда что-то выбрано, справа «?» с
 * клавишами. Поиск сжимается до 12rem раньше, чем фильтры уходят на вторую
 * строку; «?» всегда стоит в конце первой строки, а не один на своей. На
 * телефоне фильтры сворачиваются в «Фильтры (n)».
 */
export function QueueToolbar({
  search,
  filters,
  activeCount,
  resetHref,
  keys = [],
}: Readonly<{
  search: QueueSearch;
  filters: ReactNode;
  /** Число выбранных фильтров и поиска: для «Фильтры (n)». */
  activeCount: number;
  resetHref: string | null;
  /** Клавиши страницы сверх общих — в окне «?». */
  keys?: readonly QueueKey[];
}>) {
  return (
    <div role="group" aria-label="Поиск и фильтры" className="flex items-start gap-2" data-testid="queue-toolbar">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <form key={search.defaultValue} action={search.action} method="get" role="search" aria-label={search.label} className="min-w-48 flex-1 basis-48 md:max-w-sm">
          {Object.entries(search.hidden).map(([name, value]) => value ? <input key={name} type="hidden" name={name} value={value} /> : null)}
          <label className="relative block">
            <span className="sr-only">{search.label}</span>
            <Icon name="search" size={18} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-fg-3" />
            <input
              data-queue-search=""
              type="search"
              name={search.name}
              defaultValue={search.defaultValue}
              placeholder={search.placeholder}
              maxLength={200}
              enterKeyHint="search"
              autoComplete="off"
              className="h-11 w-full min-w-0 rounded-ctl border border-control-edge bg-surface ps-10 pe-3 t-body text-fg placeholder:text-fg-3 hover:bg-surface-2 focus-visible:border-accent"
            />
          </label>
        </form>
        <QueueFilterDisclosure activeCount={activeCount}>
          {filters}
          {resetHref ? (
            <Link href={resetHref} scroll={false} className="inline-flex min-h-11 items-center px-2 t-label text-fg-2 underline underline-offset-4 hover:text-fg">
              Сбросить
            </Link>
          ) : null}
        </QueueFilterDisclosure>
      </div>
      <QueueKeyboardHelp extra={keys} />
    </div>
  );
}
