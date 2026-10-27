"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/**
 * Вход «Сегодня» нового вида для страницы (серверной): её граф не должен тянуть клиентские куски нового вида (таблицы,
 * панели, подсказки на Radix) в первую загрузку каждого сотрудника, поэтому настоящий вид подгружается отсюда. Разметка
 * на сервере та же (`ssr` включён), данные и права страница читает до этого и передаёт как свойства.
 */
export const TodayNextLazy = dynamic(() => import("./TodayNextPage").then((module) => module.TodayNextPage).catch(onScreenLoadFailed));
