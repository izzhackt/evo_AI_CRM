"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/**
 * Вход «Календаря» нового вида для страницы (серверной): клиентские куски нового вида (панель, вкладки, подсказки на
 * Radix) не должны идти в первую загрузку сотрудников с прежним видом, поэтому настоящий вид подгружается отсюда.
 * Данные и права страница читает до этого и передаёт как свойства (только данные).
 */
export const CalendarNextLazy = dynamic(() => import("./CalendarNextPage").then((module) => module.CalendarNextPage).catch(onScreenLoadFailed));
