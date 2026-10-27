"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Входы «Заявок» нового вида для серверной страницы: подгружаются, только когда рисуются (см. `TodayNextLazy`). */
export const RequestsNextLazy = dynamic(() => import("./RequestsNextPage").then((module) => module.RequestsNextPage).catch(onScreenLoadFailed));
export const RequestsNextInvalidLazy = dynamic(() => import("./RequestsNextPage").then((module) => module.RequestsNextInvalid).catch(onScreenLoadFailed));
