// Строки срезов «Документы» и «Оплата» (M2), которых нет в общих словарях веба.
// Подключаются в mobile-strings.ts одной строкой-спредом. KY: needs native proofreading.

export const DOCS_RU = {
  "docs.pickTitle": "Как добавить файл",
  "docs.pickFiles": "Выбрать файл",
  "docs.pickPhoto": "Фото из галереи",
  "docs.pickCamera": "Снять камерой",
  "docs.pickCancel": "Отмена",
  "docs.cancelUpload": "Отменить загрузку",
  "docs.errorType": "Подходят только PDF, JPG и PNG.",
  "docs.errorEmpty": "Файл пустой. Выберите другой.",
  "docs.errorPick": "Не удалось получить файл. Попробуйте ещё раз.",
  "docs.errorSession": "Сессия истекла. Войдите заново.",
  "docs.uploadCancelled": "Загрузка отменена.",
  "docs.resumeUpload": "Продолжить загрузку",
  "docs.cameraDenied": "Нет доступа к камере. Разрешите его в настройках телефона.",
  "docs.openSettings": "Открыть настройки",
  "docs.downloading": "Скачиваем…",
  "docs.downloadFailed": "Не удалось скачать файл. Повторите.",
  "docs.downloadUnavailable": "Файл сейчас недоступен. Попробуйте позже.",
  "docs.downloadForbidden": "Этот файл сейчас нельзя скачать. Если он нужен, напишите EVO.",
  "docs.emptyAction": "Написать EVO",
  "docs.progress": "Загружено {percent}%",
  "payments.heading": "Что нужно оплатить",
  "payments.howTitle": "Как оплатить",
  "payments.howBody": "", // TODO(owner #1359): текст «как оплатить» даёт владелец; пока пусто, блок не показывается
  "payments.writeEvo": "Написать EVO",
  "payments.writeEvoHint": "Откроется чат с командой EVO.",
} as const;

/** Ключи, которые намеренно пусты, пока не пришёл текст владельца (экран скрывает блок). */
export const PENDING_OWNER_KEYS: readonly string[] = ["payments.howBody"];

export type DocsStringKey = keyof typeof DOCS_RU;

export const DOCS_KY: Readonly<Record<DocsStringKey, string>> = {
  "docs.pickTitle": "Файлды кантип кошуу",
  "docs.pickFiles": "Файл тандоо",
  "docs.pickPhoto": "Галереядан сүрөт",
  "docs.pickCamera": "Камерадан тартуу",
  "docs.pickCancel": "Жокко чыгаруу",
  "docs.cancelUpload": "Жүктөөнү токтотуу",
  "docs.errorType": "PDF, JPG жана PNG гана жарайт.",
  "docs.errorEmpty": "Файл бош. Башкасын тандаңыз.",
  "docs.errorPick": "Файлды алуу мүмкүн болгон жок. Дагы аракет кылыңыз.",
  "docs.errorSession": "Сессия бүттү. Кайра кириңиз.",
  "docs.uploadCancelled": "Жүктөө токтотулду.",
  "docs.resumeUpload": "Жүктөөнү улантуу",
  "docs.cameraDenied": "Камерага уруксат жок. Телефондун жөндөөлөрүнөн уруксат бериңиз.",
  "docs.openSettings": "Жөндөөлөрдү ачуу",
  "docs.downloading": "Жүктөп алып жатабыз…",
  "docs.downloadFailed": "Файл жүктөлүп алынган жок. Кайталаңыз.",
  "docs.downloadUnavailable": "Файл азыр жеткиликсиз. Кийинчерээк аракет кылыңыз.",
  "docs.downloadForbidden": "Бул файлды азыр жүктөп алууга болбойт. Керек болсо, EVO'го жазыңыз.",
  "docs.emptyAction": "EVO'го жазуу",
  "docs.progress": "Жүктөлдү: {percent}%",
  "payments.heading": "Эмнени төлөө керек",
  "payments.howTitle": "Кантип төлөө керек",
  "payments.howBody": "", // TODO(owner #1359)
  "payments.writeEvo": "EVO'го жазуу",
  "payments.writeEvoHint": "EVO командасы менен чат ачылат.",
};
