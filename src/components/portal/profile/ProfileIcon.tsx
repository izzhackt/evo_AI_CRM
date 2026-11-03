/**
 * Иконки заголовков карточек «Профиля» — тот же штрих 1.5 на сетке 20×20,
 * что у иконок меню кабинета (Shell). Только украшают подпись рядом:
 * aria-hidden, смысл несёт текст заголовка.
 */
const PATHS = {
  // Консультация: пузырь диалога.
  consultation: "M3.5 4.5h13v8.5h-7.2L6 16v-3H3.5zM6.8 7.5h6.4M6.8 10h4.4",
  // Язык портала: глобус.
  language: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM2.5 10h15M10 2.5c2 2.1 3 4.6 3 7.5s-1 5.4-3 7.5c-2-2.1-3-4.6-3-7.5s1-5.4 3-7.5z",
  // ИИ-помощники: искра.
  ai: "M10 3l1.5 4.2L15.8 9l-4.3 1.6L10 15l-1.5-4.4L4.2 9l4.3-1.8zM15.5 13.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z",
  // Удаление аккаунта: корзина.
  deletion: "M4.5 6h11M8 6V4.5h4V6M6 6l.7 10h6.6L14 6M8.5 9v4.5M11.5 9v4.5",
  // Результаты тестов: планшет с отметкой.
  tests: "M6.5 3.5h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM8 3.5V2.8h4v.7M7.7 10.2l1.6 1.6 3-3.3",
} as const;

export function ProfileIcon({ name }: Readonly<{ name: keyof typeof PATHS }>) {
  return (
    <svg className="pt-profile-icon" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={PATHS[name]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
