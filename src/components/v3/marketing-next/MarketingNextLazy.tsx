"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Вход «Маркетинга» нового вида: таблицы, панели и подсказки на Radix не идут в первую загрузку сотрудников с прежним видом (см. `TodayNextLazy`). */
export const MarketingNextLazy = dynamic(() => import("./MarketingNextPage").then((module) => module.MarketingNextPage).catch(onScreenLoadFailed));
