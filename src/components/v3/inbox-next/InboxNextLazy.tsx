"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/**
 * Вход «WhatsApp» нового вида для серверной страницы: рамка, список и шапка диалога подгружаются, только когда рисуются
 * (см. `TodayNextLazy`). Движок чата `InboxChat` тот же, что у прежнего вида; разметка на сервере та же (`ssr` включён).
 */
export const InboxNextLazy = dynamic(() => import("./InboxNextPage").then((module) => module.InboxNextPage).catch(onScreenLoadFailed));
