// Каталоги кэша документов: скачанные файлы и промежуточные копии для загрузки. Документы студента не
// должны жить в кэше дольше сессии: каталоги очищаются при выходе, удалении аккаунта и запуске приложения.
// Каждое скачивание пишет в свой подкаталог (UUID), поэтому второе нажатие не удаляет файл, который
// системный просмотр ещё держит открытым.
import { Directory, Paths } from "expo-file-system";

export const DOWNLOAD_DIR = "evo-downloads";
export const UPLOAD_STAGE_DIR = "evo-uploads";

export type DirLike = Readonly<{ exists: boolean; delete: () => void }>;

/** Удалить оба каталога; любые сбои глотаются (кэш не должен ломать выход из аккаунта). */
export async function clearDownloadCache(dirs: readonly DirLike[] = [new Directory(Paths.cache, DOWNLOAD_DIR), new Directory(Paths.cache, UPLOAD_STAGE_DIR)]): Promise<void> {
  for (const dir of dirs) {
    try {
      if (dir.exists) dir.delete();
    } catch {
      // файл ещё открыт или каталога нет: остальное всё равно чистим
    }
  }
}
