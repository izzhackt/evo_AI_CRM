// Куда ведёт уход с теста. Раньше шло `router.back()`: если тест открыли из другого раздела («Профессии», «Английский»), в стеке
// «Тестов» он единственный, «назад» уходила во вкладку «Главная», а сам тест оставался жить в памяти (ревью QA 22). Теперь путь один:
// `dismissTo("/tests")` возвращает к каталогу, если он под тестом в стеке, иначе ставит каталог на место теста. Тест не остаётся
// в стеке, и «Все тесты» открываются при любом входе. Если тест открыли с карточки «Профессий», после каталога открывается она.
import { router } from "expo-router";

/** Откуда открыт тест; в ссылке `/tests/orvis92?from=professions`. Остальные входы (каталог, «Английский», ссылка снаружи) ведут в «Все тесты». */
export type TestsOrigin = "professions";

/** Значение `from` из ссылки: чужие и повторные значения - не откуда. */
export function testsOrigin(value: string | string[] | undefined | null): TestsOrigin | null {
  return value === "professions" ? "professions" : null;
}

export function leaveTests(origin: TestsOrigin | null): void {
  router.dismissTo("/tests");
  if (origin === "professions") router.navigate("/professions");
}
