// Всё, что приложение держит на устройстве о студенте и что надо стереть при выходе и при удалении
// аккаунта: состояние интерфейса по пользователю и кэш скачанных файлов. Другие срезы (например, кэш
// каталога вузов) добавляют свою очистку в этот список или через `registerLocalDataCleaner`, а не правят выход.
import { clearPerUserUiState } from "@/features/admission/useOpenSteps";
import { clearDownloadCache } from "@/features/documents/download-cache";
import { clearCscaUiState } from "@/features/learning/csca/ui-state";
import { clearRegistrationLocalData } from "@/features/registration/draft-store";
import { clearUniversityCaches } from "@/features/universities/cache";

type Cleaner = () => Promise<void>;

const cleaners = new Set<Cleaner>([
  () => clearPerUserUiState(), // M1: раскрытые шаги
  () => clearDownloadCache(), // M2/M3: скачанные и подготовленные файлы
  () => clearUniversityCaches(), // M4: копия каталога вузов на диске
  () => clearCscaUiState(), // M5: вкладка обзора CSCA по студенту
  () => clearRegistrationLocalData(), // M7: личная ссылка и черновики анкеты
]);

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
