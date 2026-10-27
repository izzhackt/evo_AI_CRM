"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Вход «Настроек» нового вида: таблицы, панели и подсказки на Radix не идут в первую загрузку сотрудников с прежним видом (см. `TodayNextLazy`). */
export const SettingsNextLazy = dynamic(() => import("./SettingsNextPage").then((module) => module.SettingsNextPage).catch(onScreenLoadFailed));
