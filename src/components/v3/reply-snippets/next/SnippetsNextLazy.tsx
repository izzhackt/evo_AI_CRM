"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Вход «Шаблонов ответов» нового вида: клиентские куски (таблица, панель) не идут в первую загрузку сотрудников с прежним видом. */
export const SnippetsNextLazy = dynamic(() => import("./SnippetsNext").then((module) => module.SnippetsNext).catch(onScreenLoadFailed));
