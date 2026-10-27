"use client";

import { lazy, Suspense } from "react";

import { onLazyFailed } from "@/components/kit/lazy-failure";
import { OUTLINE_BUTTON } from "@/components/kit/outline-button";

export type FeedOverflowProps = Readonly<{ count: number; title: string; children: React.ReactNode }>;

// Выезжающая панель (Radix Dialog, прокрутка) — сотни килобайт кода не для каждой отдачи страницы: прежний вид профиля
// и кабинет её не показывают. Подгружается, когда лента «Нового вида» рисуется (`lazy`: см. `HelpTip`).
// Не пришёл код панели: остаётся та же кнопка (панель не откроется), а не ошибка на весь экран; ошибка записана в
// `console.error`. Ошибка в коде куска — не обрыв связи: она уходит выше (`onLazyFailed`).
const FeedOverflowImpl = lazy(() => import("./FeedOverflowImpl").then((module) => ({ default: module.FeedOverflowImpl })).catch(onLazyFailed({ default: FeedOverflowStatic })));

/** Та же кнопка «Ещё N», что у настоящей (`OUTLINE_BUTTON`): имя, `data-testid` и вид одни; нет только панели. */
function FeedOverflowStatic({ count }: FeedOverflowProps) {
  return (
    <button type="button" aria-label={`Ещё ${count} в ленте`} data-testid="v3-feed-overflow" className={OUTLINE_BUTTON}>
      Ещё {count}
    </button>
  );
}

/** «Ещё N» у ленты: пока панель подгружается, на месте стоит та же кнопка (имя, `data-testid` и вид те же). */
export function FeedOverflow(props: FeedOverflowProps) {
  return (
    <Suspense fallback={<FeedOverflowStatic {...props} />}>
      <FeedOverflowImpl {...props} />
    </Suspense>
  );
}
