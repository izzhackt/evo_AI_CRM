"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Вход «Финансов» нового вида: таблицы, окна и подсказки на Radix не идут в первую загрузку сотрудников с прежним видом (см. `TodayNextLazy`). */
export const FinanceNextLazy = dynamic(() => import("./FinanceNextPage").then((module) => module.FinanceNextPage).catch(onScreenLoadFailed));
