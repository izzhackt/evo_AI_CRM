import { resetAnnouncementsForTests } from "@/ui/a11y";
import { setReducedMotionForTests } from "@/ui/motion";

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

// Движение в тестах выключено, как при «Уменьшить движение» в системе: тесты проверяют состояние экрана, а не кадры.
// Тест движения включает его сам: `setReducedMotionForTests(false)`.
setReducedMotionForTests(true);

// Память `announce` (окно повторов) живёт в модуле, а тесты идут друг за другом быстрее окна: без сброса второй тест,
// озвучивший то же сообщение, увидел бы 0 вызовов читалки. Сброс перед каждым тестом.
beforeEach(() => {
  resetAnnouncementsForTests();
});
