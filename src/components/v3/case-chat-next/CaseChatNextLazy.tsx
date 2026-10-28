"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Входы «Переписки» нового вида для серверной страницы: подгружаются, только когда рисуются (см. `TodayNextLazy`). */
export const CaseChatNextLazy = dynamic(() => import("./CaseChatNextPage").then((module) => module.CaseChatNextPage).catch(onScreenLoadFailed));
export const CaseChatNextFailureLazy = dynamic(() => import("./CaseChatNextFailure").then((module) => module.CaseChatNextFailure).catch(onScreenLoadFailed));
