"use client";

import dynamic from "next/dynamic";

/** Входы «ИИ-агентов» нового вида для серверных страниц: подгружаются, только когда рисуются (см. `TodayNextLazy`). */
export const NextAgentsViewLazy = dynamic(() => import("./NextAgentsView").then((module) => module.NextAgentsView));
export const NextAgentPageLazy = dynamic(() => import("./NextAgentPage").then((module) => module.NextAgentPage));
export const NextAgentUnavailableLazy = dynamic(() => import("./NextAgentUnavailable").then((module) => module.NextAgentUnavailable));
