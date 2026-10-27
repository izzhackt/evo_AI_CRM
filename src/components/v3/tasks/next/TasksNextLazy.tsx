"use client";

import dynamic from "next/dynamic";

/** Входы «Задач» нового вида для серверной страницы: подгружаются, только когда рисуются (см. `TodayNextLazy`). */
export const TasksNextLazy = dynamic(() => import("./TasksNext").then((module) => module.TasksNext));
export const TasksNextFailureLazy = dynamic(() => import("./TasksNextFailure").then((module) => module.TasksNextFailure));
