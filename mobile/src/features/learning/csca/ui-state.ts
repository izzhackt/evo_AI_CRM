// Вкладка CSCA больше не запоминается (решение владельца D7, 25.11.2026: как на вебе, всегда «Об экзамене», если нет
// `?view=lessons`). Прежние версии приложения сохраняли выбор по студенту под ключами `csca_overview:<студент>`; при выходе
// эти остатки по-прежнему стираются, чтобы на устройстве не осталось следов прошлого студента.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const CSCA_OVERVIEW_PREFIX = "csca_overview:";

export async function clearCscaUiState(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => key.startsWith(CSCA_OVERVIEW_PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // Хранилище недоступно: нечего чистить.
  }
}
