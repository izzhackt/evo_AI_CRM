"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";
import type { SalesFrameNextPage, SalesReportNextPage } from "./SalesReportNextPage";

/** Входы «Отчёта продаж» нового вида для серверной страницы: подгружаются, только когда рисуются (см. `TodayNextLazy`). */
export const SalesReportNextLazy = dynamic<ComponentProps<typeof SalesReportNextPage>>(
  () => import("./SalesReportNextPage").then((module) => module.SalesReportNextPage).catch(onScreenLoadFailed),
);
export const SalesFrameNextLazy = dynamic<ComponentProps<typeof SalesFrameNextPage>>(
  () => import("./SalesReportNextPage").then((module) => module.SalesFrameNextPage).catch(onScreenLoadFailed),
);
