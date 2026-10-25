"use client";

import { useSyncExternalStore } from "react";

import { boundaryLocale, getBoundaryStrings } from "@/lib/portal/boundary-i18n";

const subscribe = () => () => {};

/**
 * Язык для границ ошибок: на сервере и при гидрации RU, затем `<html lang>`.
 * useSyncExternalStore переключает без предупреждения о расхождении.
 */
export function useBoundaryStrings() {
  const locale = useSyncExternalStore(
    subscribe,
    () => boundaryLocale(document.documentElement.lang),
    () => "ru" as const,
  );
  return getBoundaryStrings(locale);
}
