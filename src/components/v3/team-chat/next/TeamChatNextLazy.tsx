"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/**
 * Входы «Командного чата» нового вида для страницы (серверной): рамка страницы и кусок кита (шапка, «?») не идут в первую загрузку
 * сотрудников с прежним видом. Сам чат (`TeamChat`) страница и так несёт в графе — его движок и данные те же.
 */
export const TeamChatNextLazy = dynamic(() => import("./TeamChatNextPage").then((module) => module.TeamChatNextPage).catch(onScreenLoadFailed));
export const TeamChatNextFailureLazy = dynamic(() => import("./TeamChatNextPage").then((module) => module.TeamChatNextFailure).catch(onScreenLoadFailed));
