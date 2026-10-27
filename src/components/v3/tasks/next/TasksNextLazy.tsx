"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Входы «Задач» нового вида для серверной страницы: подгружаются, только когда рисуются (см. `TodayNextLazy`). */
export const TasksNextLazy = dynamic(() => import("./TasksNext").then((module) => module.TasksNext).catch(onScreenLoadFailed));
export const TasksNextFailureLazy = dynamic(() => import("./TasksNextFailure").then((module) => module.TasksNextFailure).catch(onScreenLoadFailed));
