// Всё, что приложение держит на устройстве о студенте и что надо стереть при выходе и при удалении
// аккаунта: состояние интерфейса по пользователю и кэш скачанных файлов. Другие срезы (например, кэш
// каталога вузов) добавляют свою очистку через `registerLocalDataCleaner`, а не правят выход.
import { clearPerUserUiState } from "@/features/admission/useOpenSteps";
import { clearDownloadCache } from "@/features/documents/download-cache";

type Cleaner = () => Promise<void>;

const cleaners = new Set<Cleaner>([() => clearPerUserUiState(), () => clearDownloadCache()]);

/** Добавить очистку; возвращает отмену регистрации. */
export function registerLocalDataCleaner(cleaner: Cleaner): () => void {
  cleaners.add(cleaner);
  return () => {
    cleaners.delete(cleaner);
  };
}

/** Выполнить все очистки; сбой одной не мешает остальным и не прерывает выход. */
export async function clearAllLocalData(): Promise<void> {
  await Promise.allSettled([...cleaners].map((cleaner) => cleaner()));
}
