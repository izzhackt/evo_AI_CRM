// Разговор с Эви, пока открыт кабинет (веб #1530, решение владельца 17.11.2026): память стоит в оболочке кабинета
// (`(app)/_layout.tsx`), поэтому «Назад» в «Профессии» и новый вход в «Подбор с Эви» разговор не стирают. Только память
// приложения: на устройство ничего не пишется (ни AsyncStorage, ни SecureStore, ни файлов). Выход размонтирует оболочку и
// уносит хранилище с ней; после нового запуска приложения разговор тоже начинается заново, как после перезагрузки на вебе.
// Это двойник `src/components/portal/evi/EviMemory.tsx`: тот файл «use client» и с веб-алиасами, приложению его брать нельзя;
// само хранилище, снимок разговора и правила возврата после сбоя общие (`@web/lib/portal/evi-memory`).
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { createEviMemoryStore, type EviMemory, type EviMemoryStore } from "@web/lib/portal/evi-memory";

const EviMemoryContext = createContext<EviMemoryStore | null>(null);

/** Хранилище на один открытый кабинет: оболочка кабинета размонтируется при выходе, и чужого разговора в памяти не остаётся. */
export function EviMemoryProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createEviMemoryStore);
  return <EviMemoryContext.Provider value={store}>{children}</EviMemoryContext.Provider>;
}

/**
 * Память разговора этого студента (`owner` - id пользователя из сессии; кроме этой памяти он нигде не хранится и никуда не
 * отправляется). Она отдаёт разговор только его владельцу: для другого студента она пуста, а его приветствие стирает прежний
 * разговор. Вне оболочки (тесты, экран отдельно) или без метки - null: разговор живёт, пока открыт экран.
 */
export function useEviMemory(owner: string | null): EviMemory | null {
  const store = useContext(EviMemoryContext);
  return useMemo<EviMemory | null>(
    () => (store && owner ? { load: () => store.load(owner), save: (snapshot) => store.save(owner, snapshot) } : null),
    [store, owner],
  );
}
