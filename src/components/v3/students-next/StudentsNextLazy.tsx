"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Вход «Студентов» и EVO Docs нового вида для серверной страницы: подгружается, только когда рисуется (см. `TodayNextLazy`). */
export const StudentsNextLazy = dynamic(() => import("./StudentsNextPage").then((module) => module.StudentsNextPage).catch(onScreenLoadFailed));
