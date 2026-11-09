jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// expo-crypto без нативного модуля отдаёт undefined: в тестах UUID берётся из Node.
jest.mock("expo-crypto", () => ({
  randomUUID: () => require("node:crypto").randomUUID(),
  getRandomBytes: (size: number) => new Uint8Array(require("node:crypto").randomBytes(size)),
}));

// Экран в тесте без навигатора: эффект фокуса срабатывает при монтировании.
jest.mock("@/lib/focus", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => require("react").useEffect(effect, [effect]),
}));
