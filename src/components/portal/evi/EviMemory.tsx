"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";

import type { EviMemory, EviSnapshot } from "@/lib/portal/evi-memory";

const EviMemoryContext = createContext<EviMemory | null>(null);

/**
 * Разговор с Эви, пока открыт кабинет (решение владельца 17.11.2026). Живёт в оболочке кабинета, поэтому переход из итога на
 * карточку профессии и «Назад» его не стирают (так было до 24.11). Только память страницы: в браузере ничего не
 * записывается, после перезагрузки или выхода (оболочка закрывается) разговор начинается заново.
 */
export function EviMemoryProvider({ children }: Readonly<{ children: ReactNode }>) {
  const kept = useRef<EviSnapshot | null>(null);
  const memory = useMemo<EviMemory>(() => ({
    load: () => kept.current,
    save: (snapshot) => { kept.current = snapshot; },
  }), []);
  return <EviMemoryContext.Provider value={memory}>{children}</EviMemoryContext.Provider>;
}

/** Память разговора кабинета; вне оболочки (статический рендер, проверки) — null. */
export function useEviMemory(): EviMemory | null {
  return useContext(EviMemoryContext);
}
