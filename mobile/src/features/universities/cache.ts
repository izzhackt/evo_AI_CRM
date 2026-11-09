// Дисковая копия индекса каталога (iPhone: UniversityIndexDiskCache). Ключ - пользователь,
// чужая копия не читается. В файле ровно тело ответа RPC; пишется только полный ответ;
// неверная обёртка = удаление. Очищается при выходе и при 42501.
import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "evo.university-index.v1.";

export type IndexDisk = Readonly<{
  read(userKey: string): Promise<unknown | null>;
  write(userKey: string, body: unknown): Promise<void>;
  remove(userKey: string): Promise<void>;
}>;

export const asyncStorageDisk: IndexDisk = {
  async read(userKey) {
    try {
      const raw = await AsyncStorage.getItem(PREFIX + userKey);
      return raw === null ? null : (JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  },
  async write(userKey, body) {
    try {
      await AsyncStorage.setItem(PREFIX + userKey, JSON.stringify(body));
    } catch {
      // кэш - ускорение, а не источник правды
    }
  },
  async remove(userKey) {
    await AsyncStorage.removeItem(PREFIX + userKey).catch(() => undefined);
  },
};

/** Выход из аккаунта: копии каталога всех пользователей на устройстве удаляются. */
export async function clearUniversityCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((key) => key.startsWith(PREFIX)));
  } catch {
    // нечего удалять
  }
}
