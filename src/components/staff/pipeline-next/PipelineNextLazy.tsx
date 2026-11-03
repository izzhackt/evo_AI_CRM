"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Входы «Воронки продаж» нового вида для серверной страницы: подгружаются, только когда рисуются (см. `TodayNextLazy`). */
export const PipelineNextLazy = dynamic(() => import("./PipelineNextPage").then((module) => module.PipelineNextPage).catch(onScreenLoadFailed));
export const PipelineClosedNextLazy = dynamic(() => import("./PipelineNextPage").then((module) => module.PipelineClosedNextPage).catch(onScreenLoadFailed));
