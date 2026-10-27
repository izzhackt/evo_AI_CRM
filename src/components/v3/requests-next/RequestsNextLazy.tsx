"use client";

import dynamic from "next/dynamic";

/** Входы «Заявок» нового вида для серверной страницы: подгружаются, только когда рисуются (см. `TodayNextLazy`). */
export const RequestsNextLazy = dynamic(() => import("./RequestsNextPage").then((module) => module.RequestsNextPage));
export const RequestsNextInvalidLazy = dynamic(() => import("./RequestsNextPage").then((module) => module.RequestsNextInvalid));
