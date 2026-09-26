import Link from "next/link";
import type { ReactNode } from "react";

import { SkeletonBlock } from "@/components/ui";

const TITLE_WIDTHS = ["w-7/12", "w-5/12", "w-1/2"];
const META_WIDTHS = ["w-1/3", "w-1/4"];

/**
 * Загрузка очереди — форма будущего экрана: ряд вкладок, строка инструментов
 * и волосяные строки, без текста-заглушки и без скачка раскладки.
 */
export function QueueSkeleton({ rows = 6, label = "Загружаем задачи…", leading = true, head = true }: Readonly<{
  rows?: number;
  /** Что загружается — для читалки. */
  label?: string;
  /** Круг выполнения слева (у задач); у списков без него — false. */
  leading?: boolean;
  /** Вкладки и строка инструментов; у очереди без них («Сегодня») — false. */
  head?: boolean;
}>) {
  return (
    <div aria-busy="true" className="space-y-4" data-testid="queue-skeleton">
      <p role="status" className="sr-only">{label}</p>
      {head ? <>
        <div className="flex gap-2 border-b border-border pb-2">
          {["w-20", "w-26", "w-30"].map((width) => <SkeletonBlock key={width} className={`h-11 rounded-nav ${width}`} />)}
        </div>
        <div className="flex flex-wrap gap-2">
          <SkeletonBlock className="h-11 w-full max-w-sm rounded-ctl" />
          <SkeletonBlock className="hidden h-11 w-24 rounded-ctl md:block" />
          <SkeletonBlock className="hidden h-11 w-24 rounded-ctl md:block" />
        </div>
      </> : null}
      <ul>
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex min-h-[3.25rem] items-center gap-2 border-b border-border py-2">
            {leading ? <span aria-hidden="true" className="mx-3 size-5 shrink-0 animate-pulse rounded-full border-2 border-surface-2 motion-reduce:animate-none" /> : null}
            {/* Колонка срока перед названием — как у строк очереди. */}
            <span className="hidden w-28 shrink-0 sm:block"><SkeletonBlock className="h-3.5 w-12 rounded-nav" /></span>
            <div className="min-w-0 flex-1 space-y-1.5">
              <SkeletonBlock className={`h-3.5 rounded-nav ${TITLE_WIDTHS[index % TITLE_WIDTHS.length]}`} />
              <SkeletonBlock className={`h-3 rounded-nav ${META_WIDTHS[index % META_WIDTHS.length]}`} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Честная пустота: что именно пусто и одно подходящее действие. */
export function QueueEmpty({ title, action = null }: Readonly<{ title: string; action?: ReactNode }>) {
  return (
    <div role="status" className="flex flex-col items-center gap-3 border-t border-border py-12 text-center" data-testid="queue-empty">
      <p className="t-item text-fg">{title}</p>
      {action}
    </div>
  );
}

/** Ошибка чтения: что не получилось и «Повторить» тем же адресом. */
export function QueueError({ text, retryHref }: Readonly<{ text: string; retryHref: string }>) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 border-y border-border py-8" data-testid="queue-error">
      <p className="t-item text-danger">{text}</p>
      <Link href={retryHref} className="inline-flex min-h-11 items-center rounded-ctl border border-control-edge bg-surface px-3 t-label text-fg-2 hover:bg-surface-2 hover:text-fg">
        Повторить
      </Link>
    </div>
  );
}

/** Тихая ссылка-действие очереди (пустота, «Показать больше задач»). */
export const QUEUE_QUIET_LINK = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg";
