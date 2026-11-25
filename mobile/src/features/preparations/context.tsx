// Что нужно всем частям экрана программы, чтобы не тянуть это через каждый компонент: область запросов (организация,
// участник, дело, программа), устройство (выбор файла, загрузка, скачивание), тексты документов и «обновить» после записи.
import { createContext, useContext, type ReactNode } from "react";

import type { PendingScope } from "@/features/preparations/pending-store";
import type { DocumentStrings } from "@/features/preparations/document-strings";
import type { PreparationIo } from "@/features/preparations/io";

export type PreparationContextValue = Readonly<{
  scope: PendingScope;
  io: PreparationIo;
  strings: DocumentStrings;
  /** Перечитать требования и документы после записи (веб: `onSaved={() => update(false)}`). */
  onSaved: () => void;
  /** Растёт при каждом обновлении: истории перезагружаются, а не показывают прежние страницы (веб: `historyEpoch`). */
  epoch: number;
}>;

const Context = createContext<PreparationContextValue | null>(null);

export function PreparationProvider({ value, children }: { value: PreparationContextValue; children: ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePreparation(): PreparationContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("usePreparation вне PreparationProvider");
  return value;
}
