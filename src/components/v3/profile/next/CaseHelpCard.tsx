"use client";

import { lazy, Suspense } from "react";

import type { CaseHelpPage } from "@/lib/platform-admissions-support-contract";

// Карточка тянет склейку классов и Radix нового вида; страница профиля у остальных сотрудников её не показывает (`lazy`: см. `HelpTip`).
const CaseHelpCardImpl = lazy(() => import("./CaseHelpCardImpl").then((module) => ({ default: module.CaseHelpCardImpl })));

/** «Обращения студента» карточкой «Нового вида»: подгружается, когда рисуется; пока грузится — строка о загрузке, как у страницы. */
export function CaseHelpCard({ initialPage }: Readonly<{ initialPage: CaseHelpPage }>) {
  return (
    <Suspense fallback={<p role="status" className="t-body-compact text-fg-2">Загружаем обращения студента…</p>}>
      <CaseHelpCardImpl initialPage={initialPage} />
    </Suspense>
  );
}
