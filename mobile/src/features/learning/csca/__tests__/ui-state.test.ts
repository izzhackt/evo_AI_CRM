// Вкладка CSCA больше не запоминается (D7), но остатки прежних версий стираются при выходе: на устройстве не остаётся
// следов прошлого студента.
import AsyncStorage from "@react-native-async-storage/async-storage";

import { CSCA_OVERVIEW_PREFIX, clearCscaUiState } from "@/features/learning/csca/ui-state";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("clearCscaUiState", () => {
  it("стирает выбор вкладки каждого студента и не трогает чужие ключи", async () => {
    await AsyncStorage.multiSet([
      [`${CSCA_OVERVIEW_PREFIX}user-a`, "open"],
      [`${CSCA_OVERVIEW_PREFIX}user-b`, "closed"],
      ["evo.lang", "ky"],
      ["evo.theme", "dark"],
    ]);
    await clearCscaUiState();
    expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual(["evo.lang", "evo.theme"]);
  });

  it("пустое хранилище и сбой хранилища не падают", async () => {
    await expect(clearCscaUiState()).resolves.toBeUndefined();
    const spy = jest.spyOn(AsyncStorage, "getAllKeys").mockRejectedValueOnce(new Error("storage down"));
    await expect(clearCscaUiState()).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
