"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Вход «ИИ-агента» (ответы Gemini в чате) в новом виде: таблицы, панели и подсказки на Radix не идут в первую загрузку сотрудников с прежним видом (см. `TodayNextLazy`). */
export const AiAgentNextLazy = dynamic(() => import("./AiAgentNextPage").then((module) => module.AiAgentNextPage).catch(onScreenLoadFailed));
