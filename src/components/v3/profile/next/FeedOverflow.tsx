"use client";

import { lazy, Suspense } from "react";

export type FeedOverflowProps = Readonly<{ count: number; title: string; children: React.ReactNode }>;

// Выезжающая панель (Radix Dialog, прокрутка) — сотни килобайт кода не для каждой отдачи страницы: прежний вид профиля
// и кабинет её не показывают. Подгружается, когда лента «Нового вида» рисуется (`lazy`: см. `HelpTip`).
const FeedOverflowImpl = lazy(() => import("./FeedOverflowImpl").then((module) => ({ default: module.FeedOverflowImpl })));

/** «Ещё N» у ленты: пока панель подгружается, на месте стоит та же кнопка (имя и `data-testid` те же). */
export function FeedOverflow(props: FeedOverflowProps) {
  return (
    <Suspense
      fallback={
        <button type="button" aria-label={`Ещё ${props.count} в ленте`} data-testid="v3-feed-overflow"
          className="inline-flex h-11 w-fit items-center justify-center rounded-ctl border border-input bg-surface px-4 t-label text-fg">
          Ещё {props.count}
        </button>
      }
    >
      <FeedOverflowImpl {...props} />
    </Suspense>
  );
}
