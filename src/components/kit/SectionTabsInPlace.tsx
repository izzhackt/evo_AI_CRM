"use client";

import { lazy, Suspense, type ComponentType } from "react";

import { onLazyFailed } from "@/components/kit/lazy-failure";
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
// Не пришёл код вкладок: на их месте пусто (как пока грузятся), а не ошибка, которая сняла бы страницу; ошибка записана в
// `console.error`. На сервере отказ — ошибка в коде: она уходит выше (`onLazyFailed`).
const SectionTabsInPlaceImpl = lazy<ComponentType<SectionTabsInPlaceProps>>(() => import("./SectionTabsInPlaceImpl").then((module) => ({ default: module.SectionTabsInPlaceImpl })).catch(onLazyFailed({ default: () => null })));

export function SectionTabsInPlace(props: SectionTabsInPlaceProps) {
  return (
    <Suspense fallback={null}>
      <SectionTabsInPlaceImpl {...props} />
    </Suspense>
  );
}
