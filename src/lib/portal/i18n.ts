/**
 * Портальный словарный слой (PORT-2, дизайн-контракт
 * docs/design/portal/design-contract.md).
 *
 * Правила:
 * - Портал говорит на RU и KY. Каждый новый портальный текст обязан иметь
 *   обе версии: тип `Record<ключи ru, string>` ловит пропуск на typecheck,
 *   а tests/portal-i18n.test.mjs — на прогоне тестов. Тихого фолбэка на
 *   английский нет и не будет.
 * - `en` из существующего механизма локали (src/lib/i18n.ts, cookie `locale`)
 *   намеренно резолвится в RU: у портала нет английской версии интерфейса,
 *   и случайная английская строка хуже честной русской (план §7, тексты).
 * - Staff-словари (src/lib/i18n-data.ts DICTS, src/lib/v3/wording.ts) сюда
 *   не импортируются — изоляция от staff CRM по дизайн-контракту.
 */
import type { Locale } from "../i18n-data.ts";

const shellRu = {
  skipToContent: "Перейти к содержимому",
  home: "EVO Admissions — кабинет студента",
  notifications: "Уведомления",
  account: "Ваш аккаунт",
  logout: "Выйти",
  openingSection: "Открываем раздел «{label}»",
  "nav.overview": "Поступление",
  "nav.documents": "Документы",
  "nav.universities": "Университеты",
  "nav.payments": "Оплата",
  "nav.notifications": "Уведомления",
  "nav.tests": "Тесты",
} as const;

type ShellKey = keyof typeof shellRu;

const shellKy: Readonly<Record<ShellKey, string>> = {
  skipToContent: "Мазмунга өтүү",
  home: "EVO Admissions — студенттин кабинети",
  notifications: "Билдирмелер",
  account: "Сиздин аккаунт",
  logout: "Чыгуу",
  openingSection: "«{label}» бөлүмүн ачып жатабыз",
  "nav.overview": "Тапшыруу",
  "nav.documents": "Документтер",
  "nav.universities": "Университеттер",
  "nav.payments": "Төлөм",
  "nav.notifications": "Билдирмелер",
  "nav.tests": "Тесттер",
};

/**
 * Каталог университетов «Атлас» (PORT-3a): список⇄карта, карточка вуза.
 * Ключи уровней/статусов набора зеркалят доменные значения
 * `platform-university-catalog.ts`, но словарь — портальный (staff-словари
 * не импортируются).
 */
const universitiesRu = {
  kicker: "Каталог",
  title: "Университеты",
  lead: "Проверенные вузы, программы и даты наборов — в списке и на карте.",
  filtersAria: "Фильтры каталога",
  searchLabel: "Название",
  searchPlaceholder: "Найти университет",
  countryLabel: "Страна",
  allCountries: "Все страны",
  levelLabel: "Уровень",
  allLevels: "Все уровни",
  submit: "Найти",
  resetFilters: "Сбросить фильтры",
  viewAria: "Представление каталога",
  viewList: "Список",
  viewMap: "Карта",
  openCard: "Программы и сроки",
  nearestIntake: "Ближайший набор",
  intakeDeadlineByDate: "подача до {date}",
  intakeStartFromDate: "старт {date}",
  intakeDatesPending: "даты уточняются у источника",
  nextPage: "Следующая страница",
  emptyTitle: "По этому запросу пока нет опубликованных карточек",
  emptyBody: "Попробуйте убрать фильтры. Новые сведения появятся после проверки и публикации.",
  unavailable: "Не удалось загрузить каталог. Обновите страницу. Это не означает, что опубликованных университетов нет.",
  mapAria: "Карта университетов",
  mapLoading: "Загружаем карту…",
  mapFailed: "Карту не удалось загрузить. Список работает полностью — переключитесь на «Список».",
  mapShown: "На карте: {count}",
  mapWithoutPoint: "Без точки на карте: {count} — эти вузы есть в списке.",
  mapOpenCard: "Открыть карточку",
  mapCloseCard: "Закрыть",
  backToCatalog: "Все университеты",
  detailLead: "Программы, условия поступления и даты наборов.",
  website: "Сайт учебного заведения",
  programsHeading: "Программы и наборы",
  duration: "Длительность",
  teachingLanguage: "Язык обучения",
  programPage: "Официальная страница программы",
  intakeStart: "Начало обучения",
  intakeDeadline: "Срок подачи",
  intakeSource: "Источник срока",
  cardSource: "Основной источник карточки",
  newTab: "(в новой вкладке)",
  "intakeStatus.closed": "Приём по опубликованному сроку закрыт",
  "intakeStatus.needsConfirmation": "Дату нужно подтвердить",
  "intakeStatus.open": "Приём открыт по данным источника",
  "intakeStatus.announced": "Набор объявлен",
  "intakeStatus.unclear": "Условия набора требуют уточнения",
  "level.language": "Языковой курс",
  "level.foundation": "Подготовительная программа",
  "level.diploma": "Диплом",
  "level.bachelor": "Бакалавриат",
  "level.master": "Магистратура",
  "level.doctorate": "Докторантура",
  photoMissing: "Проверенное фото кампуса пока не добавлено",
  photoFailed: "Не удалось загрузить фото кампуса",
  photoBy: "Фото: {author}",
  photoCrop: "Кадрирование в карточке.",
} as const;

type UniversitiesKey = keyof typeof universitiesRu;

const universitiesKy: Readonly<Record<UniversitiesKey, string>> = {
  kicker: "Каталог",
  title: "Университеттер",
  lead: "Текшерилген ЖОЖдор, программалар жана кабыл алуу даталары — тизмеде жана картада.",
  filtersAria: "Каталог чыпкалары",
  searchLabel: "Аталышы",
  searchPlaceholder: "Университет издөө",
  countryLabel: "Өлкө",
  allCountries: "Бардык өлкөлөр",
  levelLabel: "Деңгээл",
  allLevels: "Бардык деңгээлдер",
  submit: "Издөө",
  resetFilters: "Чыпкаларды алып салуу",
  viewAria: "Каталогдун көрүнүшү",
  viewList: "Тизме",
  viewMap: "Карта",
  openCard: "Программалар жана мөөнөттөр",
  nearestIntake: "Жакынкы кабыл алуу",
  intakeDeadlineByDate: "тапшыруу {date} чейин",
  intakeStartFromDate: "башталышы {date}",
  intakeDatesPending: "даталар булактан такталууда",
  nextPage: "Кийинки барак",
  emptyTitle: "Бул суроо боюнча жарыяланган карточкалар азырынча жок",
  emptyBody: "Чыпкаларды алып салып көрүңүз. Жаңы маалымат текшерүүдөн жана жарыялоодон кийин чыгат.",
  unavailable: "Каталог жүктөлгөн жок. Баракты жаңыртыңыз. Бул жарыяланган университеттер жок дегенди билдирбейт.",
  mapAria: "Университеттердин картасы",
  mapLoading: "Картаны жүктөп жатабыз…",
  mapFailed: "Карта жүктөлгөн жок. Тизме толук иштейт — «Тизме» көрүнүшүнө өтүңүз.",
  mapShown: "Картада: {count}",
  mapWithoutPoint: "Картада чекити жоктор: {count} — бул ЖОЖдор тизмеде бар.",
  mapOpenCard: "Карточканы ачуу",
  mapCloseCard: "Жабуу",
  backToCatalog: "Бардык университеттер",
  detailLead: "Программалар, кабыл алуу шарттары жана даталары.",
  website: "Окуу жайдын сайты",
  programsHeading: "Программалар жана кабыл алуулар",
  duration: "Узактыгы",
  teachingLanguage: "Окутуу тили",
  programPage: "Программанын расмий барагы",
  intakeStart: "Окуунун башталышы",
  intakeDeadline: "Тапшыруу мөөнөтү",
  intakeSource: "Мөөнөттүн булагы",
  cardSource: "Карточканын негизги булагы",
  newTab: "(жаңы өтмөктө)",
  "intakeStatus.closed": "Жарыяланган мөөнөт боюнча кабыл алуу жабык",
  "intakeStatus.needsConfirmation": "Датаны тактоо керек",
  "intakeStatus.open": "Булактын маалыматы боюнча кабыл алуу ачык",
  "intakeStatus.announced": "Кабыл алуу жарыяланды",
  "intakeStatus.unclear": "Кабыл алуу шарттарын тактоо керек",
  "level.language": "Тил курсу",
  "level.foundation": "Даярдоо программасы",
  "level.diploma": "Диплом",
  "level.bachelor": "Бакалавриат",
  "level.master": "Магистратура",
  "level.doctorate": "Докторантура",
  photoMissing: "Кампустун текшерилген сүрөтү азырынча кошула элек",
  photoFailed: "Кампустун сүрөтү жүктөлгөн жок",
  photoBy: "Сүрөт: {author}",
  photoCrop: "Карточкада сүрөт кыркылып көрсөтүлөт.",
};

/** Все портальные словари, по неймспейсам. Экспорт — для контракт-теста. */
export const PORTAL_DICTIONARIES = {
  shell: { ru: shellRu, ky: shellKy },
  universities: { ru: universitiesRu, ky: universitiesKy },
} as const;

export type PortalNamespace = keyof typeof PORTAL_DICTIONARIES;

export type PortalStrings<N extends PortalNamespace> =
  (typeof PORTAL_DICTIONARIES)[N]["ru"];

/**
 * Строки неймспейса для локали. KY — полный словарь (пропуск ключа — ошибка
 * компиляции и теста), RU — базовый, EN — сознательно RU.
 */
export function getPortalStrings<N extends PortalNamespace>(
  namespace: N,
  locale: Locale,
): PortalStrings<N> {
  const dictionary = PORTAL_DICTIONARIES[namespace];
  return (locale === "ky" ? dictionary.ky : dictionary.ru) as PortalStrings<N>;
}

/** Подстановка значений в шаблон вида «Открываем раздел «{label}»». */
export function formatPortalString(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) =>
    Object.hasOwn(values, key) ? values[key] : match,
  );
}
