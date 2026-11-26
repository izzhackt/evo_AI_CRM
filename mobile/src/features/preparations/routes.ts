// Маршрут «Требования программы» (веб: /portal/preparations/[applicationId]). Постоянная часть и ссылка вынесены сюда
// заранее (Волна 0 паритета, 25.11.2026), чтобы «Главная», страница вуза, «Что нового» и ближайшие даты вели на экран
// ещё до того, как он будет построен (его делает срез «Документы и программы», файл
// `src/app/(app)/preparations/[applicationId].tsx`). Заглушки маршрута нет: до готового экрана ссылка ведёт на
// «страница не найдена» expo-router, а не на пустой экран.
import type { Href } from "expo-router";

/** Шаблон маршрута: имя файла `app/(app)/preparations/[applicationId].tsx`, параметр `applicationId`. */
export const PREPARATION_ROUTE = "/preparations/[applicationId]";

/** Куда ведут ссылки, если идентификатор программы пуст или не годится: список «Мои программы» на «Главной». */
const FALLBACK_PATH = "/home?list=programs";

/**
 * Годится ли идентификатор как сегмент пути: непустая строка, не `.` и не `..` (их разбирают как «здесь» и «выше»,
 * `encodeURIComponent` точки не кодирует). Настоящий идентификатор - uuid из строки сервера, сюда не должен попадать
 * ничего другого; проверка нужна, чтобы испорченные данные не увели на чужой маршрут и не уронили экран.
 */
function usable(applicationId: unknown): applicationId is string {
  if (typeof applicationId !== "string") return false;
  const id = applicationId.trim();
  return id !== "" && id !== "." && id !== "..";
}

/**
 * Путь к экрану одной программы строкой: `/preparations/<applicationId>`. Для кода, который работает со строками
 * (`go()` в `features/portal/navigation.ts`, результат `linkTarget`). Идентификатор кодируется, поэтому `/`, `?` и `#`
 * внутри него не меняют путь. Пустой идентификатор, `.` и `..` дают `/home?list=programs`: исключение из обработчика
 * нажатия уронило бы приложение, а список программ студент и так видит.
 */
export function preparationPath(applicationId: string): string {
  return usable(applicationId) ? `/preparations/${encodeURIComponent(applicationId)}` : FALLBACK_PATH;
}

/**
 * Ссылка на экран одной программы для `router.push`, `router.navigate` и `<Link href>`. Объектная форма, как у остальных
 * динамических маршрутов приложения (`/tests/[key]`, `/professions/[cardId]`): expo-router сам подставляет параметр.
 * Негодный идентификатор: ссылка на список программ, как у `preparationPath`.
 *
 * Приведение идёт через `unknown`: пока файла маршрута нет, типизированные маршруты (`.expo/types/router.d.ts`, его
 * создаёт `expo start`) этот маршрут не знают, и прямое `as Href` не компилируется (TS2352). В CI таких файлов нет
 * (папка `.expo/` в .gitignore), поэтому ошибка видна только там, где запускали `expo start`. Через `unknown` код
 * собирается и с созданными типами, и без них, и после появления файла маршрута.
 */
export function preparationHref(applicationId: string): Href {
  if (!usable(applicationId)) return { pathname: "/home", params: { list: "programs" } } as unknown as Href;
  return { pathname: PREPARATION_ROUTE, params: { applicationId } } as unknown as Href;
}
