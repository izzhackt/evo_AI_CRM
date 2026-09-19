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
  "nav.messages": "Сообщения",
  "nav.universities": "Университеты",
  "nav.professions": "Профессии",
  "nav.english": "Английский",
  "nav.favorites": "Избранное",
  "nav.payments": "Оплата",
  "nav.notifications": "Уведомления",
  "nav.tests": "Тесты",
  "nav.profile": "Профиль",
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
  "nav.messages": "Билдирүүлөр",
  "nav.universities": "Университеттер",
  "nav.professions": "Кесиптер",
  "nav.english": "Англис тили",
  "nav.favorites": "Тандалмалар",
  "nav.payments": "Төлөм",
  "nav.notifications": "Билдирмелер",
  "nav.tests": "Тесттер",
  "nav.profile": "Профиль",
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
  favoriteAdd: "В избранное",
  favoriteRemove: "Убрать из избранного",
  favoriteError: "Не удалось сохранить. Нажмите ещё раз.",
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
  favoriteAdd: "Тандалмаларга кошуу",
  favoriteRemove: "Тандалмалардан алып салуу",
  favoriteError: "Сакталган жок. Дагы бир жолу басыңыз.",
};

/**
 * Раздел «Избранное» (PORT-3b): сохранённые вузы и сравнение фактических
 * свойств. Никаких рейтингов и «шансов поступления» — план §6/§14.
 */
const favoritesRu = {
  kicker: "Каталог",
  title: "Избранное",
  lead: "Сохранённые университеты и сравнение их фактических свойств.",
  savedCount: "Сохранено: {count}",
  emptyTitle: "Пока ничего не сохранено",
  emptyBody: "Отметьте университет сердечком в каталоге — он появится здесь.",
  emptyAction: "Открыть каталог",
  unavailable: "Не удалось загрузить избранное. Обновите страницу. Сохранённые записи не потеряны.",
  compareHeading: "Сравнение",
  compareHint: "Отметьте минимум два университета, чтобы сравнить их.",
  compareSelect: "Сравнивать: {name}",
  compareProperty: "Свойство",
  compareCountry: "Страна и город",
  compareLevels: "Уровни",
  comparePrograms: "Программы",
  compareIntake: "Ближайший набор",
  cityUnknown: "Город не указан",
} as const;

type FavoritesKey = keyof typeof favoritesRu;

const favoritesKy: Readonly<Record<FavoritesKey, string>> = {
  kicker: "Каталог",
  title: "Тандалмалар",
  lead: "Сакталган университеттер жана алардын факт-касиеттерин салыштыруу.",
  savedCount: "Сакталды: {count}",
  emptyTitle: "Азырынча эч нерсе сакталган жок",
  emptyBody: "Каталогдон университетти жүрөк белгиси менен белгилеңиз — ал ушул жерде чыгат.",
  emptyAction: "Каталогду ачуу",
  unavailable: "Тандалмалар жүктөлгөн жок. Баракты жаңыртыңыз. Сакталган жазуулар жоголгон жок.",
  compareHeading: "Салыштыруу",
  compareHint: "Салыштыруу үчүн кеминде эки университетти белгилеңиз.",
  compareSelect: "Салыштырууга кошуу: {name}",
  compareProperty: "Касиет",
  compareCountry: "Өлкө жана шаар",
  compareLevels: "Деңгээлдер",
  comparePrograms: "Программалар",
  compareIntake: "Жакынкы кабыл алуу",
  cityUnknown: "Шаар көрсөтүлгөн эмес",
};

/**
 * Экран «Профиль» (PORT-5a, дизайн-контракт §6): данные, язык RU/KY,
 * личные тесты, выход и инициирование удаления аккаунта — с честным
 * описанием последствий, без обещаний сроков (план §7 тексты, §13).
 */
const profileRu = {
  kicker: "Аккаунт",
  title: "Профиль",
  lead: "Данные аккаунта, язык портала и управление доступом.",
  unavailable: "Не удалось загрузить профиль. Обновите страницу.",
  dataHeading: "Данные",
  nameLabel: "Имя",
  emailLabel: "Email",
  testsLink: "Личные результаты тестов",
  languageHeading: "Язык портала",
  languageHint: "Сохраняется в аккаунте и действует на всех ваших устройствах.",
  languageRu: "Русский",
  languageKy: "Кыргызский",
  languageSave: "Сохранить язык",
  languageSaved: "Язык сохранён.",
  languageError: "Не удалось сохранить язык. Повторите.",
  sessionHeading: "Сессия",
  logout: "Выйти",
  deleteHeading: "Удаление аккаунта",
  deleteDescription: "Команда EVO обработает запрос и закроет доступ к кабинету: избранное, результаты тестов и загруженные материалы станут недоступны. Записи, которые обязаны храниться по договору и закону, сохраняются по действующим правилам.",
  deleteConfirm: "Отправить запрос на удаление",
  deleteRequested: "Запрос отправлен — обрабатывается командой.",
  deleteError: "Не удалось отправить запрос. Повторите.",
} as const;

type ProfileKey = keyof typeof profileRu;

const profileKy: Readonly<Record<ProfileKey, string>> = {
  kicker: "Аккаунт",
  title: "Профиль",
  lead: "Аккаунттун маалыматы, порталдын тили жана кирүүнү башкаруу.",
  unavailable: "Профиль жүктөлгөн жок. Баракты жаңыртыңыз.",
  dataHeading: "Маалымат",
  nameLabel: "Аты-жөнү",
  emailLabel: "Email",
  testsLink: "Жеке тест жыйынтыктары",
  languageHeading: "Порталдын тили",
  languageHint: "Аккаунтта сакталат жана бардык түзмөктөрүңүздө колдонулат.",
  languageRu: "Орусча",
  languageKy: "Кыргызча",
  languageSave: "Тилди сактоо",
  languageSaved: "Тил сакталды.",
  languageError: "Тил сакталган жок. Кайталаңыз.",
  sessionHeading: "Сессия",
  logout: "Чыгуу",
  deleteHeading: "Аккаунтту өчүрүү",
  deleteDescription: "EVO командасы сурамды иштеп чыгып, кабинетке кирүүнү жабат: тандалмалар, тест жыйынтыктары жана жүктөлгөн материалдар жеткиликсиз болот. Келишим жана мыйзам боюнча сакталууга тийиш жазуулар колдонуудагы эрежелер боюнча сакталат.",
  deleteConfirm: "Өчүрүүгө сурам жөнөтүү",
  deleteRequested: "Сурам жөнөтүлдү — команда иштеп жатат.",
  deleteError: "Сурам жөнөтүлгөн жок. Кайталаңыз.",
};

/**
 * «Запрос консультации» (PORT-5b, план §6 «Консультация»): кнопка в карточке
 * вуза и в профиле, форма с необязательной заметкой, честное состояние
 * «Запрос отправлен — менеджер свяжется» и история своих запросов.
 */
const consultationRu = {
  heading: "Консультация",
  hint: "Задайте вопрос о поступлении — менеджер EVO свяжется с вами.",
  ctaButton: "Записаться на консультацию",
  noteLabel: "Комментарий (необязательно)",
  notePlaceholder: "Вопрос или удобное время для звонка",
  submit: "Отправить запрос",
  cancel: "Отмена",
  sent: "Запрос отправлен — менеджер свяжется.",
  error: "Не удалось отправить запрос. Повторите.",
  historyHeading: "Ваши запросы",
  historyUnavailable: "Не удалось загрузить запросы. Обновите страницу.",
  historyDate: "Отправлен {date}",
  handledDate: "Обработан {date}",
  universityLine: "Университет: {name}",
  statusRequested: "Запрос отправлен — менеджер свяжется",
  statusHandled: "Обработан",
} as const;

type ConsultationKey = keyof typeof consultationRu;

const consultationKy: Readonly<Record<ConsultationKey, string>> = {
  heading: "Консультация",
  hint: "Тапшыруу боюнча суроо бериңиз — EVO менеджери сиз менен байланышат.",
  ctaButton: "Консультацияга жазылуу",
  noteLabel: "Комментарий (милдеттүү эмес)",
  notePlaceholder: "Суроо же чалуу үчүн ыңгайлуу убакыт",
  submit: "Сурам жөнөтүү",
  cancel: "Жокко чыгаруу",
  sent: "Сурам жөнөтүлдү — менеджер байланышат.",
  error: "Сурам жөнөтүлгөн жок. Кайталаңыз.",
  historyHeading: "Сиздин сурамдарыңыз",
  historyUnavailable: "Сурамдар жүктөлгөн жок. Баракты жаңыртыңыз.",
  historyDate: "Жөнөтүлдү {date}",
  handledDate: "Иштелди {date}",
  universityLine: "Университет: {name}",
  statusRequested: "Сурам жөнөтүлдү — менеджер байланышат",
  statusHandled: "Иштелди",
};

/**
 * Раздел «Английский» (PORT-4c): карта модуля, урок-раннер с мгновенным
 * разбором, завершение и повторение ошибок. Английские формулировки заданий —
 * учебное содержание и не переводятся (план §2); интерфейс — RU/KY.
 */
const englishRu = {
  kicker: "Обучение",
  title: "Английский",
  lead: "Модуль уроков с нуля: теория, задания и разбор каждого ответа.",
  unavailable: "Не удалось загрузить уроки. Обновите страницу. Ваш прогресс не потерян.",
  emptyTitle: "Уроки готовятся",
  emptyBody: "Когда проверенный модуль будет опубликован, он появится здесь.",
  progress: "Пройдено уроков: {done} из {total}",
  lessonLabel: "Урок {n}",
  exercisesCount: "Заданий: {count}",
  lastResult: "Верно: {correct} из {total}",
  statusCompleted: "Пройден",
  statusDraft: "В процессе",
  statusNew: "Не начат",
  startLesson: "Начать урок",
  continueLesson: "Продолжить",
  repeatLesson: "Пройти ещё раз",
  reviewEntry: "Повторить ошибки",
  testEntry: "Тест по английскому",
  testEntryHint: "36 заданий покажут сильные стороны и темы для подготовки.",
  backToModule: "Все уроки",
  goalHeading: "Цель урока",
  theoryHeading: "Объяснение",
  toExercises: "К заданиям",
  exerciseCounter: "Задание {n} из {total}",
  answerButton: "Ответить",
  nextButton: "Далее",
  toCompletion: "К итогу урока",
  finishButton: "Завершить урок",
  finishHint: "После завершения ответы этой попытки нельзя изменить.",
  verdictCorrect: "Верно",
  verdictWrong: "Неверно",
  correctAnswerLabel: "Правильный ответ",
  matchingHint: "Для каждого выражения выберите пару из правой колонки.",
  matchingPairLabel: "Пара для «{left}»",
  matchingEmptyOption: "Выберите пару",
  shortAnswerLabel: "Ваш ответ",
  shortAnswerHint: "Регистр, лишние пробелы и точка в конце не влияют на проверку.",
  readingPassageHeading: "Текст",
  saving: "Сохраняем…",
  answeredStatus: "Ответ сохранён. Разбор ниже.",
  errorConflict: "Попытка изменилась в другой вкладке. Загрузите сохранённую попытку.",
  errorInvalid: "Ответ не принят. Проверьте заполнение и повторите.",
  errorDenied: "Урок недоступен. Войдите в кабинет заново.",
  errorUnavailable: "Не удалось подтвердить сохранение. Ответ остался на экране — повторите.",
  retry: "Повторить",
  reloadDraft: "Загрузить сохранённую попытку",
  exitBlocked: "Переход остановлен: дождитесь сохранения ответа.",
  completionHeading: "Урок пройден",
  completionShare: "Верно: {correct} из {total}",
  completionNoMistakes: "Все задания решены верно.",
  completionMistakes: "Заданий с ошибками: {count}. Они добавлены в повторение.",
  reviewTitle: "Повторение ошибок",
  reviewLead: "Новая попытка тех заданий, где были ошибки. Ответ проверяется сразу.",
  reviewEmptyTitle: "Повторять пока нечего",
  reviewEmptyBody: "Здесь появятся задания, решённые с ошибкой в завершённых уроках.",
  reviewEmptyAction: "К урокам",
  reviewItemFrom: "Урок {n}",
  reviewDone: "Разобрано: {done} из {total}",
} as const;

type EnglishKey = keyof typeof englishRu;

const englishKy: Readonly<Record<EnglishKey, string>> = {
  kicker: "Окуу",
  title: "Англис тили",
  lead: "Нөлдөн баштаган сабактар модулу: теория, тапшырмалар жана ар бир жооптун разбору.",
  unavailable: "Сабактар жүктөлгөн жок. Баракты жаңыртыңыз. Прогрессиңиз жоголгон жок.",
  emptyTitle: "Сабактар даярдалып жатат",
  emptyBody: "Текшерилген модуль жарыялангандан кийин ушул жерде чыгат.",
  progress: "Өтүлгөн сабактар: {total} ичинен {done}",
  lessonLabel: "{n}-сабак",
  exercisesCount: "Тапшырмалар: {count}",
  lastResult: "Туура: {total} ичинен {correct}",
  statusCompleted: "Өтүлдү",
  statusDraft: "Улантылууда",
  statusNew: "Башталa элек",
  startLesson: "Сабакты баштоо",
  continueLesson: "Улантуу",
  repeatLesson: "Дагы бир жолу өтүү",
  reviewEntry: "Каталарды кайталоо",
  testEntry: "Англис тили боюнча тест",
  testEntryHint: "36 тапшырма күчтүү жактарды жана даярдана турган темаларды көрсөтөт.",
  backToModule: "Бардык сабактар",
  goalHeading: "Сабактын максаты",
  theoryHeading: "Түшүндүрмө",
  toExercises: "Тапшырмаларга өтүү",
  exerciseCounter: "{total} ичинен {n}-тапшырма",
  answerButton: "Жооп берүү",
  nextButton: "Кийинки",
  toCompletion: "Сабактын жыйынтыгына",
  finishButton: "Сабакты аяктоо",
  finishHint: "Аяктагандан кийин бул аракеттин жоопторун өзгөртүүгө болбойт.",
  verdictCorrect: "Туура",
  verdictWrong: "Туура эмес",
  correctAnswerLabel: "Туура жооп",
  matchingHint: "Ар бир сөз айкашы үчүн оң мамычадан жупту тандаңыз.",
  matchingPairLabel: "«{left}» үчүн жуп",
  matchingEmptyOption: "Жупту тандаңыз",
  shortAnswerLabel: "Сиздин жооп",
  shortAnswerHint: "Баш тамга, ашыкча боштуктар жана аягындагы чекит текшерүүгө таасир этпейт.",
  readingPassageHeading: "Текст",
  saving: "Сактап жатабыз…",
  answeredStatus: "Жооп сакталды. Разбору төмөндө.",
  errorConflict: "Аракет башка өтмөктө өзгөрдү. Сакталган аракетти жүктөңүз.",
  errorInvalid: "Жооп кабыл алынган жок. Толтурууну текшерип, кайталаңыз.",
  errorDenied: "Сабак жеткиликсиз. Кабинетке кайра кириңиз.",
  errorUnavailable: "Сактоо ырасталган жок. Жооп экранда калды — кайталаңыз.",
  retry: "Кайталоо",
  reloadDraft: "Сакталган аракетти жүктөө",
  exitBlocked: "Өтүү токтотулду: жооптун сакталышын күтүңүз.",
  completionHeading: "Сабак өтүлдү",
  completionShare: "Туура: {total} ичинен {correct}",
  completionNoMistakes: "Бардык тапшырмалар туура чечилди.",
  completionMistakes: "Ката кеткен тапшырмалар: {count}. Алар кайталоого кошулду.",
  reviewTitle: "Каталарды кайталоо",
  reviewLead: "Ката кеткен тапшырмаларга жаңы аракет. Жооп дароо текшерилет.",
  reviewEmptyTitle: "Азырынча кайталай турган нерсе жок",
  reviewEmptyBody: "Аякталган сабактарда ката кеткен тапшырмалар ушул жерде чыгат.",
  reviewEmptyAction: "Сабактарга",
  reviewItemFrom: "{n}-сабак",
  reviewDone: "Талданды: {total} ичинен {done}",
};

/**
 * Раздел «Профессии» (PORT-4c): сетка по интересам и карточка профессии.
 * Названия программ и вузов остаются на языке каталога (имена собственные).
 */
const professionsRu = {
  kicker: "Исследование",
  title: "Профессии",
  lead: "Как устроен рабочий день, что придётся уметь и куда за этим поступать.",
  unavailable: "Не удалось загрузить профессии. Обновите страницу.",
  emptyTitle: "По этому интересу пока нет карточек",
  emptyBody: "Уберите фильтр или выберите другой интерес.",
  filterAria: "Фильтр по интересам",
  allScales: "Все интересы",
  resonance: "Созвучно твоим интересам",
  resonanceHint: "Отметка по вашему результату теста интересов. Это ориентир для исследования, а не назначение профессии.",
  testEntry: "Тест интересов",
  testEntryHint: "92 утверждения покажут, какие занятия вам ближе.",
  backToGrid: "Все профессии",
  scalesLabel: "Интересы",
  dayHeading: "День из жизни",
  environmentHeading: "Среда",
  skillsHeading: "Навыки",
  interestingHeading: "Что интересно",
  hardHeading: "Что сложно",
  trialHeading: "Пробное задание",
  studyHeading: "Куда учиться",
  programsHeading: "Программы в каталоге EVO",
  programLabel: "Программа: {title}",
  openUniversity: "Карточка вуза",
  programMissing: "Точной программы в карточке вуза сейчас нет — направление указано как ориентир.",
  universityMissing: "Вуза с этой программой сейчас нет в каталоге — направление указано как ориентир.",
  sourcesHeading: "Источник описания",
  attribution: "Описание адаптировано EVO по сводке O*NET® (USDOL/ETA), лицензия CC BY 4.0; «день из жизни», пробное задание и направления — редакция EVO.",
  attributionLink: "Условия лицензии",
  "scale.leadership": "Лидерство",
  "scale.organization": "Организация",
  "scale.altruism": "Помощь людям",
  "scale.creativity": "Творчество",
  "scale.analysis": "Анализ",
  "scale.production": "Производство",
  "scale.adventure": "Приключения",
  "scale.erudition": "Эрудиция",
} as const;

type ProfessionsKey = keyof typeof professionsRu;

const professionsKy: Readonly<Record<ProfessionsKey, string>> = {
  kicker: "Изилдөө",
  title: "Кесиптер",
  lead: "Жумуш күнү кандай өтөт, эмнени билүү керек жана ал үчүн кайда тапшыруу керек.",
  unavailable: "Кесиптер жүктөлгөн жок. Баракты жаңыртыңыз.",
  emptyTitle: "Бул кызыгуу боюнча карточкалар азырынча жок",
  emptyBody: "Чыпканы алып салыңыз же башка кызыгууну тандаңыз.",
  filterAria: "Кызыгуулар боюнча чыпка",
  allScales: "Бардык кызыгуулар",
  resonance: "Кызыгууларыңа үндөш",
  resonanceHint: "Белги кызыгуулар тестиңиздин жыйынтыгы боюнча коюлат. Бул изилдөө үчүн багыт, кесипти дайындоо эмес.",
  testEntry: "Кызыгуулар тести",
  testEntryHint: "92 ырастоо кайсы иштер сизге жакын экенин көрсөтөт.",
  backToGrid: "Бардык кесиптер",
  scalesLabel: "Кызыгуулар",
  dayHeading: "Жумуш күнү",
  environmentHeading: "Чөйрө",
  skillsHeading: "Көндүмдөр",
  interestingHeading: "Эмнеси кызыктуу",
  hardHeading: "Эмнеси кыйын",
  trialHeading: "Сынак тапшырма",
  studyHeading: "Кайда окуу керек",
  programsHeading: "EVO каталогундагы программалар",
  programLabel: "Программа: {title}",
  openUniversity: "ЖОЖдун карточкасы",
  programMissing: "ЖОЖдун карточкасында так программа азырынча жок — багыт ориентир катары көрсөтүлдү.",
  universityMissing: "Бул программасы бар ЖОЖ азырынча каталогдо жок — багыт ориентир катары көрсөтүлдү.",
  sourcesHeading: "Сүрөттөмөнүн булагы",
  attribution: "Сүрөттөмө O*NET® (USDOL/ETA) корутундусунун негизинде EVO тарабынан адаптацияланган, лицензиясы CC BY 4.0; «жумуш күнү», сынак тапшырма жана багыттар — EVO редакциясы.",
  attributionLink: "Лицензиянын шарттары",
  "scale.leadership": "Лидерлик",
  "scale.organization": "Уюштуруу",
  "scale.altruism": "Адамдарга жардам",
  "scale.creativity": "Чыгармачылык",
  "scale.analysis": "Талдоо",
  "scale.production": "Өндүрүш",
  "scale.adventure": "Укмуштуу окуялар",
  "scale.erudition": "Эрудиция",
};

/**
 * Экран «Сообщения» (PORT-5c, план §6 «Общение»): переписка с командой EVO
 * по делу — тред, отправка с честными состояниями, догрузка более ранних.
 * Разовый вопрос-ответ куратору остаётся отдельным блоком на «Поступлении»;
 * страница помечает разницу предметно.
 */
const messagesRu = {
  kicker: "Сопровождение",
  title: "Сообщения",
  lead: "Переписка с командой EVO по вашему делу.",
  unavailable: "Не удалось загрузить сообщения. Обновите страницу. Переписка не потеряна.",
  emptyTitle: "Сообщений пока нет",
  emptyBody: "Напишите команде EVO — сообщение появится здесь вместе с ответом.",
  threadAria: "Переписка по делу",
  awaitingYou: "Команда EVO ждёт вашего ответа.",
  loadEarlier: "Показать более ранние",
  loadingEarlier: "Загружаем…",
  loadEarlierError: "Не удалось загрузить более ранние сообщения. Повторите.",
  refreshError: "Не удалось обновить переписку.",
  retry: "Повторить",
  composerLabel: "Сообщение команде EVO",
  composerPlaceholder: "Напишите сообщение",
  limitHint: "До 2000 символов.",
  send: "Отправить",
  sending: "Отправляем…",
  sendError: "Сообщение не отправлено. Повторите — текст сохранён.",
  sentStatus: "Сообщение отправлено.",
  attachmentDocument: "Документ: {label}",
  attachmentTask: "Задание: {label}",
  quotedPrefix: "В ответ на: {preview}",
  differenceNote: "Здесь — переписка с командой по вашему делу. Разовый вопрос куратору с ответом — в разделе «Поступление».",
  differenceLink: "Открыть вопрос куратору",
} as const;

type MessagesKey = keyof typeof messagesRu;

const messagesKy: Readonly<Record<MessagesKey, string>> = {
  kicker: "Коштоо",
  title: "Билдирүүлөр",
  lead: "Ишиңиз боюнча EVO командасы менен кат алышуу.",
  unavailable: "Билдирүүлөр жүктөлгөн жок. Баракты жаңыртыңыз. Кат алышуу жоголгон жок.",
  emptyTitle: "Азырынча билдирүү жок",
  emptyBody: "EVO командасына жазыңыз — билдирүү жообу менен ушул жерде чыгат.",
  threadAria: "Иш боюнча кат алышуу",
  awaitingYou: "EVO командасы жообуңузду күтүп жатат.",
  loadEarlier: "Мурункуларын көрсөтүү",
  loadingEarlier: "Жүктөп жатабыз…",
  loadEarlierError: "Мурунку билдирүүлөр жүктөлгөн жок. Кайталаңыз.",
  refreshError: "Кат алышуу жаңыртылган жок.",
  retry: "Кайталоо",
  composerLabel: "EVO командасына билдирүү",
  composerPlaceholder: "Билдирүү жазыңыз",
  limitHint: "2000 белгиге чейин.",
  send: "Жөнөтүү",
  sending: "Жөнөтүп жатабыз…",
  sendError: "Билдирүү жөнөтүлгөн жок. Кайталаңыз — текст сакталып калды.",
  sentStatus: "Билдирүү жөнөтүлдү.",
  attachmentDocument: "Документ: {label}",
  attachmentTask: "Тапшырма: {label}",
  quotedPrefix: "Жооп катары: {preview}",
  differenceNote: "Бул жерде — ишиңиз боюнча команда менен кат алышуу. Кураторго жообу менен бир жолку суроо — «Тапшыруу» бөлүмүндө.",
  differenceLink: "Кураторго суроону ачуу",
};

/** Все портальные словари, по неймспейсам. Экспорт — для контракт-теста. */
export const PORTAL_DICTIONARIES = {
  shell: { ru: shellRu, ky: shellKy },
  messages: { ru: messagesRu, ky: messagesKy },
  universities: { ru: universitiesRu, ky: universitiesKy },
  favorites: { ru: favoritesRu, ky: favoritesKy },
  profile: { ru: profileRu, ky: profileKy },
  consultation: { ru: consultationRu, ky: consultationKy },
  english: { ru: englishRu, ky: englishKy },
  professions: { ru: professionsRu, ky: professionsKy },
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
