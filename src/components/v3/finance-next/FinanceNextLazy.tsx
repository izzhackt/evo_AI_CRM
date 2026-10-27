"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";
import { NextScreenLoading } from "@/components/v3/admin-next/NextScreenLoading";

/** Вход «Финансов» нового вида: таблицы, окна и подсказки на Radix не идут в первую загрузку сотрудников с прежним видом (см. `TodayNextLazy`). Границу `Suspense` над куском держит сам вход (`loading`), а не `loading.tsx` маршрута: файл маршрута менял бы и прежний вид. */
export const FinanceNextLazy = dynamic(() => import("./FinanceNextPage").then((module) => module.FinanceNextPage).catch(onScreenLoadFailed), {
  loading: () => <NextScreenLoading label="Загружаем отчёт…" />,
});
