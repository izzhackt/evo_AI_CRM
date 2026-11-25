// Строки раздела «Университеты», которых нет в общих словарях веба (src/lib/portal/i18n.ts).
// Файл ведёт только этот срез: другие срезы сюда не пишут, свои строки кладут в свой файл (таблица владельцев:
// docs/mobile/PLAN.md, «Волна 0 паритета»). В mobile-strings.ts он подключён один раз, там его не правят.
// Префикс ключей: `uni.*`, `programs.*`. Закрывает G39-G47 аудита паритета 25.11.2026.
// Прежние ключи `uni.*` и `programs.*` перенесены сюда из mobile-strings.ts как есть (25.11.2026: ни один ключ и ни одна строка не менялись).
// Новый ключ добавляется в RU и в KY сразу: тип `UniversitiesStringKey` не даст собрать KY без пары.
// Соглашение: каждая новая KY-строка получает в конце пометку `// KY: needs native proofreading`.

export const UNIVERSITIES_RU = {
  "uni.unavailable": "Каталог не загрузился. Потяните вниз, чтобы повторить.",
  "uni.refreshFailed": "Показан сохранённый каталог: обновить не удалось.",
  "uni.back": "Назад",
  "uni.pathLabel": "Путь по каталогу: {path}",
  "uni.favorites": "Мои вузы",
  "uni.favoritesHidden": "Больше нет в каталоге: {count}",
  "uni.mapAttribution": "© OpenFreeMap · © OpenMapTiles · данные © OpenStreetMap",
  "uni.programsHeading": "Программы вуза",
  "uni.openSite": "Сайт вуза",
  "uni.openSource": "Источник",
  "uni.costUsdInline": "{amount} USD",
  "uni.noCosts": "Стоимость для этого вуза пока не опубликована.",
  "uni.creditShow": "Автор и лицензия фото",
  "uni.creditHide": "Скрыть подпись фото",
  "programs.mine": "Мои программы",
  "programs.add": "Добавить в мои программы",
  "programs.adding": "Добавляем…",
  "programs.added": "Добавлено в мои программы",
  "programs.openMine": "Открыть мои программы",
  "programs.hint": "Это ещё не подача заявки в университет.",
  "programs.confirmDeadline": "Срок и доступность набора уточните у куратора.",
  "programs.caseIneligible": "Новые программы добавляет куратор при активном сопровождении.",
  "programs.error": "Не получилось проверить, добавлена ли программа. Повторите: ничего не задвоится.",
} as const;

export type UniversitiesStringKey = keyof typeof UNIVERSITIES_RU;

export const UNIVERSITIES_KY: Readonly<Record<UniversitiesStringKey, string>> = {
  "uni.unavailable": "Каталог жүктөлгөн жок. Кайталоо үчүн төмөн тартыңыз.",
  "uni.refreshFailed": "Сакталган каталог көрсөтүлдү: жаңыртуу мүмкүн болгон жок.",
  "uni.back": "Артка",
  "uni.pathLabel": "Каталог боюнча жол: {path}",
  "uni.favorites": "Менин ЖОЖдорум",
  "uni.favoritesHidden": "Каталогдо жок: {count}",
  "uni.mapAttribution": "© OpenFreeMap · © OpenMapTiles · маалыматтар © OpenStreetMap",
  "uni.programsHeading": "ЖОЖдун программалары",
  "uni.openSite": "ЖОЖдун сайты",
  "uni.openSource": "Булак",
  "uni.costUsdInline": "{amount} USD",
  "uni.noCosts": "Бул ЖОЖ үчүн баа азырынча жарыялана элек.",
  "uni.creditShow": "Сүрөттүн автору жана лицензиясы",
  "uni.creditHide": "Сүрөт жазуусун жашыруу",
  "programs.mine": "Менин программаларым",
  "programs.add": "Менин программаларыма кошуу",
  "programs.adding": "Кошуп жатабыз…",
  "programs.added": "Менин программаларыма кошулду",
  "programs.openMine": "Менин программаларымды ачуу",
  "programs.hint": "Бул дагы университетке арыз берүү эмес.",
  "programs.confirmDeadline": "Кабыл алуунун мөөнөтүн жана жеткиликтүүлүгүн куратордон тактаңыз.",
  "programs.caseIneligible": "Жаңы программаларды активдүү коштоодо куратор кошот.",
  "programs.error": "Программа кошулганын текшерүү мүмкүн болгон жок. Кайталаңыз: эч нерсе эки эседей болбойт.",
};
