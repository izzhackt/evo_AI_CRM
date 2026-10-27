"use client";

import dynamic from "next/dynamic";

import { onScreenLoadFailed } from "@/components/kit/LoadFailed";

/** Вход «Документов» нового вида: клиентские куски (таблица, панели, формы) не идут в первую загрузку прежнего вида. */
export const FilesNextLazy = dynamic(() => import("./FilesNext").then((module) => module.FilesNext).catch(onScreenLoadFailed));
