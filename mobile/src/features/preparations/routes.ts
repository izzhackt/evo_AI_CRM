// Маршрут «Требования программы» (веб: /portal/preparations/[applicationId]). Постоянная часть и ссылка вынесены сюда
// заранее (Волна 0 паритета, 25.11.2026), чтобы «Главная», страница вуза, «Что нового» и ближайшие даты вели на экран
// ещё до того, как он будет построен (его делает срез «Документы и программы», файл
// `src/app/(app)/preparations/[applicationId].tsx`). Заглушки маршрута нет: до готового экрана ссылка ведёт на
// «страница не найдена» expo-router, а не на пустой экран.
import type { Href } from "expo-router";

/** Шаблон маршрута: имя файла `app/(app)/preparations/[applicationId].tsx`, параметр `applicationId`. */
export const PREPARATION_ROUTE = "/preparations/[applicationId]";

/**
 * Путь к экрану одной программы строкой: `/preparations/<applicationId>`. Для кода, который работает со строками
 * (`go()` в `features/portal/navigation.ts`, результат `linkTarget`). Идентификатор кодируется, поэтому `/`, `?` и `#`
 * внутри него не меняют путь.
 */
export function preparationPath(applicationId: string): string {
  return `/preparations/${encodeURIComponent(applicationId)}`;
}

/**
 * Ссылка на экран одной программы для `router.push`, `router.navigate` и `<Link href>`. Объектная форма, как у остальных
 * динамических маршрутов приложения (`/tests/[key]`, `/professions/[cardId]`): expo-router сам подставляет параметр.
 * Приведение к `Href` нужно, пока файла маршрута нет: типизированные маршруты его ещё не знают.
 */
export function preparationHref(applicationId: string): Href {
  return { pathname: PREPARATION_ROUTE, params: { applicationId } } as Href;
}
