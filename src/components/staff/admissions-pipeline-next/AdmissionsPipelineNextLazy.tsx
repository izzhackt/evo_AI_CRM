"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";
import type { AdmissionsPipelineNextPage } from "./AdmissionsPipelineNextPage";

/** Вход «Воронки поступления» нового вида для серверной страницы: подгружается, только когда рисуется (см. `TodayNextLazy`). */
export const AdmissionsPipelineNextLazy = dynamic<ComponentProps<typeof AdmissionsPipelineNextPage>>(
  () => import("./AdmissionsPipelineNextPage").then((module) => module.AdmissionsPipelineNextPage).catch(onScreenLoadFailed),
);
