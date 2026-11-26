// Строки раздела «Приложение целиком (обновление, «страница не найдена», сбой экрана)» (владелец: срез «Аккаунт и приложение целиком»), которых нет в общих словарях веба (src/lib/portal/i18n.ts).
// Файл ведёт только этот срез: другие срезы сюда не пишут, свои строки кладут в свой файл (таблица владельцев:
// docs/mobile/PLAN.md, «Волна 0 паритета»). В mobile-strings.ts он подключён один раз, там его не правят.
// Префикс ключей: `app.*`. Закрывает G3-G5 аудита паритета 25.11.2026.
// Новый ключ добавляется в RU и в KY сразу: тип `AppStringKey` не даст собрать KY без пары.
// Соглашение: каждая новая KY-строка получает в конце пометку `// KY: needs native proofreading`.

export const APP_RU = {
  // Предложение обновиться (G4): веб говорит «обновите страницу» (`shell.staleVersion`), в приложении страницы нет.
  "app.update.text": "Вышла новая версия — обновите приложение.",
  "app.update.action": "Обновить",
  "app.update.later": "Позже",
  // Экран «страница не найдена» (G5): слова веба (`chromeWords.notFound`, src/lib/v3/wording.ts), кнопка ведёт в кабинет.
  "app.notFound.kicker": "Страница не найдена",
  "app.notFound.title": "Такой страницы здесь нет",
  "app.notFound.text": "Ссылка устарела или адрес введён неверно. Вернитесь в личный кабинет и откройте нужный раздел заново.",
  "app.notFound.action": "На главную",
} as const;

export type AppStringKey = keyof typeof APP_RU;

export const APP_KY: Readonly<Record<AppStringKey, string>> = {
  "app.update.text": "Жаңы версия чыкты — колдонмону жаңыртыңыз.", // KY: needs native proofreading
  "app.update.action": "Жаңыртуу", // KY: needs native proofreading
  "app.update.later": "Кийинчерээк", // KY: needs native proofreading
  "app.notFound.kicker": "Барак табылган жок", // KY: needs native proofreading
  "app.notFound.title": "Мындай барак бул жерде жок", // KY: needs native proofreading
  "app.notFound.text": "Шилтеме эскирген же дарек туура эмес терилген. Жеке кабинетке кайтып, керектүү бөлүмдү кайрадан ачыңыз.", // KY: needs native proofreading
  "app.notFound.action": "Башкы бетке", // KY: needs native proofreading
};
