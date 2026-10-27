"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Входы «ИИ-агентов» нового вида для серверных страниц: подгружаются, только когда рисуются (см. `TodayNextLazy`). */
export const NextAgentsViewLazy = dynamic(() => import("./NextAgentsView").then((module) => module.NextAgentsView).catch(onScreenLoadFailed));
export const NextAgentPageLazy = dynamic(() => import("./NextAgentPage").then((module) => module.NextAgentPage).catch(onScreenLoadFailed));
export const NextAgentUnavailableLazy = dynamic(() => import("./NextAgentUnavailable").then((module) => module.NextAgentUnavailable).catch(onScreenLoadFailed));
