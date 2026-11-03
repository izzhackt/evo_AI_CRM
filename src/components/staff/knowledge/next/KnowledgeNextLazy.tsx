"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/**
 * Вход «Базы знаний» нового вида для страницы (серверной): рамка с вкладками и список материалов (таблица, панели, меню на
 * Radix) не идут в первую загрузку администраторов с прежним видом. Документы и шаблоны страница читает сама и передаёт как `children`.
 */
export const KnowledgeNextLazy = dynamic(() => import("./KnowledgeNextPage").then((module) => module.KnowledgeNextPage).catch(onScreenLoadFailed));
