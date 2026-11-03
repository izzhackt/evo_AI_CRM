"use client";

import { lazy, Suspense } from "react";

import { onLazyFailed } from "@/components/kit/lazy-failure";
import { OUTLINE_BUTTON } from "@/components/kit/outline-button";

export type MoreSheetProps = Readonly<{
  /** Надпись кнопки: «Ещё 7», «История удалённых пунктов · 1». */
  label: string;
  /** Заголовок панели. */
  title: string;
  /** Имя кнопки для читалки, если надпись коротка («Ещё 7» без хозяина). */
  ariaLabel?: string;
  /** Пояснение к панели - за «?» её шапки. */
  help?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}>;

// Панель (Radix Dialog) подгружается, когда кнопка рисуется: у прежнего вида профиля и у кабинета её нет (`lazy`: см. `HelpTip`).
// Не пришёл код панели: остаётся та же кнопка, ошибка записана в `console.error`; ошибка в коде куска уходит выше.
const MoreSheetImpl = lazy(() => import("./MoreSheetImpl").then((module) => ({ default: module.MoreSheetImpl })).catch(onLazyFailed({ default: MoreSheetStatic })));

/** Та же кнопка (`OUTLINE_BUTTON`), что у настоящей; нет только панели. */
function MoreSheetStatic({ label, ariaLabel, testId }: MoreSheetProps) {
  return <button type="button" aria-label={ariaLabel} data-testid={testId} className={OUTLINE_BUTTON}>{label}</button>;
}

/**
 * Кнопка, открывающая выезжающую панель с вторичным: старый журнал, удалённые пункты, прочие сведения. Строки панели приходят
 * готовыми от страницы; панель их не читает и ничего не пишет. Пока код панели грузится - на месте та же кнопка.
 */
export function MoreSheet(props: MoreSheetProps) {
  return (
    <Suspense fallback={<MoreSheetStatic {...props} />}>
      <MoreSheetImpl {...props} />
    </Suspense>
  );
}
