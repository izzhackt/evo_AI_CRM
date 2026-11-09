// Дисковая копия индекса каталога (iPhone: UniversityIndexDiskCache). Файл на пользователя
// (expo-file-system, кэш-каталог приложения): AsyncStorage на Android ограничен ~6 МБ, индекс
// может быть больше. В файле ровно тело ответа RPC; пишется только полный ответ; неверная
// обёртка = удаление. Удаляется при выходе и при 42501.
import { Directory, File, Paths } from "expo-file-system";

const PREFIX = "university-index-v1-";

export type IndexDisk = Readonly<{
  read(userKey: string): Promise<unknown | null>;
  write(userKey: string, body: unknown): Promise<void>;
  remove(userKey: string): Promise<void>;
}>;

function directory(): Directory {
  return new Directory(Paths.cache, "university-index");
}

/** Имя файла из идентификатора пользователя: только безопасные знаки. */
export function indexFileName(userKey: string): string {
  return `${PREFIX}${userKey.replace(/[^A-Za-z0-9-]/gu, "_")}.json`;
}

function fileFor(userKey: string): File {
  return new File(directory(), indexFileName(userKey));
}

export const fileDisk: IndexDisk = {
  async read(userKey) {
    try {
      const file = fileFor(userKey);
      return file.exists ? (JSON.parse(await file.text()) as unknown) : null;
    } catch {
      return null;
    }
  },
  async write(userKey, body) {
    try {
      const dir = directory();
      if (!dir.exists) dir.create({ intermediates: true });
      const file = fileFor(userKey);
      if (!file.exists) file.create();
      file.write(JSON.stringify(body));
    } catch {
      // кэш - ускорение, а не источник правды
    }
  },
  async remove(userKey) {
    try {
      const file = fileFor(userKey);
      if (file.exists) file.delete();
    } catch {
      // нечего удалять
    }
  },
};

/** Выход из аккаунта: копии каталога всех пользователей на устройстве удаляются. */
export async function clearUniversityCaches(): Promise<void> {
  try {
    const dir = directory();
    if (dir.exists) dir.delete();
  } catch {
    // нечего удалять
  }
}
