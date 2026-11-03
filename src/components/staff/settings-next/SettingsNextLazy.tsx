"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";
import { NextScreenLoading } from "@/components/staff/admin-next/NextScreenLoading";

/** Вход «Настроек» нового вида: таблицы, панели и подсказки на Radix не идут в первую загрузку сотрудников с прежним видом (см. `TodayNextLazy`). Границу `Suspense` над куском держит сам вход (`loading`), а не `loading.tsx` маршрута: файл маршрута менял бы и прежний вид. */
export const SettingsNextLazy = dynamic(() => import("./SettingsNextPage").then((module) => module.SettingsNextPage).catch(onScreenLoadFailed), {
  loading: () => <NextScreenLoading label="Загружаем настройки…" />,
});

/** «Настройки» держателя `telephony.manage` без прав Admin: одна «Телефония» в рамке нового вида (тот же ленивый вход, та же заглушка). */
export const TelephonyManagerNextLazy = dynamic(() => import("./TelephonyManagerNextPage").then((module) => module.TelephonyManagerNextPage).catch(onScreenLoadFailed), {
  loading: () => <NextScreenLoading label="Загружаем настройки…" />,
});
