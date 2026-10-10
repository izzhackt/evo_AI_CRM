"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  holdInlineStalePrompt,
  isStaleDeployment,
  shouldShowStaleDeploymentNotice,
  subscribeStaleDeployment,
} from "./stale-deployment.ts";

const never = () => false;

/** Страница на прошлой сборке (см. `stale-deployment.ts`). */
export function useStaleDeployment(): boolean {
  return useSyncExternalStore(subscribeStaleDeployment, isStaleDeployment, never);
}

/** Общая строка оболочки: видна, пока подсказку не показывает своё место. */
export function useStaleDeploymentNotice(): boolean {
  return useSyncExternalStore(subscribeStaleDeployment, shouldShowStaleDeploymentNotice, never);
}

/** Пока `active`, подсказку показывает вызывающий, и общая строка молчит. */
export function useInlineStalePrompt(active: boolean): void {
  useEffect(() => (active ? holdInlineStalePrompt() : undefined), [active]);
}
