"use client";

import { lazy, Suspense } from "react";

import { onLazyFailed } from "@/components/kit/lazy-failure";
import type { CaseHelpPage } from "@/lib/platform-admissions-support-contract";

// Карточка тянет склейку классов и Radix нового вида; страница профиля у остальных сотрудников её не показывает (`lazy`: см. `HelpTip`).
// Не пришёл код карточки: строка о том, что обращения не загрузились, а не ошибка на весь профиль; ошибка записана в
// `console.error`. Ошибка в коде куска — не обрыв связи: она уходит выше (`onLazyFailed`).
const CaseHelpCardImpl = lazy(() => import("./CaseHelpCardImpl").then((module) => ({ default: module.CaseHelpCardImpl })).catch(onLazyFailed({ default: CaseHelpCardFailed })));

function CaseHelpCardFailed() {
  return <p role="alert" className="t-body-compact text-fg-2">Не удалось загрузить обращения студента. Обновите страницу.</p>;
}

/** «Обращения студента» карточкой «Нового вида»: подгружается, когда рисуется; пока грузится — строка о загрузке, как у страницы. */
export function CaseHelpCard({ initialPage }: Readonly<{ initialPage: CaseHelpPage }>) {
  return (
    <Suspense fallback={<p role="status" className="t-body-compact text-fg-2">Загружаем обращения студента…</p>}>
      <CaseHelpCardImpl initialPage={initialPage} />
    </Suspense>
  );
}
