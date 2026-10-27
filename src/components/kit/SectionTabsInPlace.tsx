"use client";

import { lazy, Suspense } from "react";

import type { SectionTab } from "@/components/kit/SectionTabs";

export type SectionTabsInPlaceProps = Readonly<{
  label: string;
  tabs: readonly SectionTab[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}>;

// Вкладки на месте — Radix Tabs; страницы нового вида почти везде держат вкладки-ссылки (`?tab=`), и Radix Tabs не должен
// идти в первую загрузку вместе с ними. Подгружается, только когда такие вкладки рисуются (набор виджетов: `/v3/ui-kit`).
const SectionTabsInPlaceImpl = lazy(() => import("./SectionTabsInPlaceImpl").then((module) => ({ default: module.SectionTabsInPlaceImpl })));

export function SectionTabsInPlace(props: SectionTabsInPlaceProps) {
  return (
    <Suspense fallback={null}>
      <SectionTabsInPlaceImpl {...props} />
    </Suspense>
  );
}
