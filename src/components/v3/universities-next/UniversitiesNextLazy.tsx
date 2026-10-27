"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/**
 * Входы «Университетов» нового вида для серверных страниц: подгружаются, только когда рисуются (см. `TodayNextLazy`):
 * у остальных сотрудников таблица, панели и Radix нового вида в первую загрузку не входят.
 */
export const UniversitiesListNextLazy = dynamic(() => import("./UniversitiesListNext").then((module) => module.UniversitiesListNext).catch(onScreenLoadFailed));
export const UniversityDetailNextLazy = dynamic(() => import("./UniversityDetailNext").then((module) => module.UniversityDetailNext).catch(onScreenLoadFailed));
export const UniversityFrameNextLazy = dynamic(() => import("./UniversityFrame").then((module) => module.UniversityFrame).catch(onScreenLoadFailed));
export const ManageIndexNextLazy = dynamic(() => import("./ManageIndexNext").then((module) => module.ManageIndexNext).catch(onScreenLoadFailed));
