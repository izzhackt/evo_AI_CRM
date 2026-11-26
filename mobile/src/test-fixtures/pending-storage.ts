// Хранилище незавершённых записей в памяти для тестов: тот же порт, что у AsyncStorage, плюс ломающиеся режимы.
import type { PendingStorage } from "@/features/preparations/pending-store";

export type MemoryPendingStorage = PendingStorage & {
  readonly data: Map<string, string>;
  /** Следующие вызовы бросают (хранилище недоступно). */
  failing: boolean;
  /** `setItem` ничего не пишет (хранилище не держит записи). */
  forgetting: boolean;
  /** `removeItem` ничего не удаляет. */
  stubborn: boolean;
};

export function memoryPendingStorage(initial: Record<string, string> = {}): MemoryPendingStorage {
  const data = new Map(Object.entries(initial));
  const storage: MemoryPendingStorage = {
    data,
    failing: false,
    forgetting: false,
    stubborn: false,
    getItem: async (key) => {
      if (storage.failing) throw new Error("storage down");
      return data.get(key) ?? null;
    },
    setItem: async (key, value) => {
      if (storage.failing) throw new Error("storage down");
      if (!storage.forgetting) data.set(key, value);
    },
    removeItem: async (key) => {
      if (storage.failing) throw new Error("storage down");
      if (!storage.stubborn) data.delete(key);
    },
    getAllKeys: async () => {
      if (storage.failing) throw new Error("storage down");
      return [...data.keys()];
    },
  };
  return storage;
}
