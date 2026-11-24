"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { createEviMemoryStore, type EviMemory, type EviMemoryStore } from "@/lib/portal/evi-memory";

const EviMemoryContext = createContext<EviMemoryStore | null>(null);

/**
 * Разговор с Эви, пока открыт кабинет (решение владельца 17.11.2026). Живёт в оболочке кабинета, поэтому переход из итога на
 * карточку профессии и «Назад» его не стирают (так было до 24.11). Только память страницы: в браузере ничего не
 * записывается, после перезагрузки или выхода (оболочка закрывается) разговор начинается заново. Разговор помечен
 * учеником (`owner`): если в соседней вкладке вошёл другой ученик, а эта вкладка не перезагружалась, его чат открывается
 * с приветствия, а прежний разговор стирается.
 */
export function EviMemoryProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [store] = useState(createEviMemoryStore);
  return <EviMemoryContext.Provider value={store}>{children}</EviMemoryContext.Provider>;
}

/**
 * Память разговора кабинета для этого ученика (`owner` — непрозрачная метка со страницы). Вне оболочки (статический рендер,
 * проверки) или без метки — null: разговор живёт, пока открыта страница.
 */
export function useEviMemory(owner: string | null): EviMemory | null {
  const store = useContext(EviMemoryContext);
  return useMemo<EviMemory | null>(() => (store && owner
    ? { load: () => store.load(owner), save: (snapshot) => store.save(owner, snapshot) }
    : null), [store, owner]);
}
