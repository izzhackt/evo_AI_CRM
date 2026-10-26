/**
 * Тексты границ кабинета (error.tsx, loading.tsx). Границы ошибок рендерятся
 * без серверного прохода по локали, поэтому клиентская граница берёт язык из
 * `<html lang>` (его ставит корневой layout по cookie `locale`), а серверная
 * загрузка — из getLocale(). `en` резолвится в RU, как во всём портале.
 * KY — без носителя языка, нужна вычитка (ky_review: pending).
 */
export type BoundaryLocale = "ru" | "ky";

export function boundaryLocale(lang: string | null | undefined): BoundaryLocale {
  return lang === "ky" ? "ky" : "ru";
}

const ru = {
  portalStaleKicker: "Вышла новая версия",
  portalStaleTitle: "Обновите страницу",
  portalStaleText: "Эта вкладка открыта на прошлой версии кабинета. После обновления раздел откроется заново.",
  portalStaleAction: "Обновить страницу",
  portalErrorKicker: "Данные недоступны",
  portalErrorTitle: "Не удалось открыть кабинет",
  portalErrorText: "Попробуйте ещё раз или откройте другой раздел через меню. Если ошибка повторится, сообщите куратору.",
  portalErrorAction: "Попробовать снова",
  portalLoadingAria: "Загружаем кабинет студента",
  portalLoadingText: "Загружаем данные… Можно перейти в другой раздел.",
  testsStaleTitle: "Вышла новая версия — обновите страницу",
  testsErrorTitle: "Не удалось открыть тест",
  testsStaleLead: "Эта вкладка открыта на прошлой версии кабинета. ",
  testsErrorLead: "Проверьте соединение и повторите загрузку. ",
  testsSavedNote: "Уже сохранённые ответы остаются в вашем кабинете.",
  testsForeignNote: " Чужая или недоступная попытка здесь не открывается.",
  testsStaleAction: "Обновить страницу",
  testsErrorAction: "Повторить загрузку",
  testsBack: "К списку тестов",
  testsLoading: "Загружаем ваши тесты…",
} as const;

const ky: Readonly<Record<keyof typeof ru, string>> = {
  portalStaleKicker: "Жаңы версия чыкты",
  portalStaleTitle: "Баракты жаңыртыңыз",
  portalStaleText: "Бул өтмөк кабинеттин мурунку версиясында ачык. Жаңыртсаңыз, бөлүм кайра ачылат.",
  portalStaleAction: "Баракты жаңыртуу",
  portalErrorKicker: "Маалымат жеткиликсиз",
  portalErrorTitle: "Кабинет ачылган жок",
  portalErrorText: "Дагы бир жолу аракет кылыңыз же менюдан башка бөлүмдү ачыңыз. Ката кайталанса, кураторго айтыңыз.",
  portalErrorAction: "Кайра аракет кылуу",
  portalLoadingAria: "Студенттин кабинети жүктөлүүдө",
  portalLoadingText: "Маалымат жүктөлүүдө… Башка бөлүмгө өтсөңүз болот.",
  testsStaleTitle: "Жаңы версия чыкты — баракты жаңыртыңыз",
  testsErrorTitle: "Тест ачылган жок",
  testsStaleLead: "Бул өтмөк кабинеттин мурунку версиясында ачык. ",
  testsErrorLead: "Байланышты текшерип, кайра жүктөңүз. ",
  testsSavedNote: "Сакталып калган жооптор кабинетиңизде турат.",
  testsForeignNote: " Бөтөн же жеткиликсиз аракет бул жерде ачылбайт.",
  testsStaleAction: "Баракты жаңыртуу",
  testsErrorAction: "Кайра жүктөө",
  testsBack: "Тесттердин тизмесине",
  testsLoading: "Тесттериңиз жүктөлүүдө…",
};

export function getBoundaryStrings(locale: BoundaryLocale) {
  return locale === "ky" ? ky : ru;
}
