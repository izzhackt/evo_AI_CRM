// Выбор вкладки обзора CSCA хранится на устройстве по студенту; при выходе все такие ключи стираются.
import AsyncStorage from "@react-native-async-storage/async-storage";

export const CSCA_OVERVIEW_PREFIX = "csca_overview:";

export const cscaOverviewKey = (userKey: string) => `${CSCA_OVERVIEW_PREFIX}${userKey}`;

export async function clearCscaUiState(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => key.startsWith(CSCA_OVERVIEW_PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // Хранилище недоступно: нечего чистить.
  }
}
