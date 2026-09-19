/**
 * Единственное место, где машинное значение превращается в слово для человека.
 *
 * Правило V3: **ключ из базы не попадает на экран никогда.** Ни
 * `meeting_scheduled`, ни `preparation`, ни имя audit action. Не потому что
 * некрасиво, а потому что это машинный контракт, а не staff wording.
 *
 * Соответственно: **не добавляйте перевод по месту, в компоненте.** Второй
 * словарь разойдётся с первым, и никто не заметит. Добавляйте сюда.
 *
 * Возврат `null` означает «показывать нечего» — вызывающий просто ничего не
 * рисует. Сырой ключ не показывается даже как запасной вариант: это ровно тот
 * случай, ради которого файл и заведён.
 */

import type {
  PlatformAuditAction,
  PlatformAuditResourceType,
} from "../platform-audit.ts";
import type {
  PlatformObligationCategory,
  PlatformObligationStatus,
} from "../platform-case-operations-contract.ts";
import type {
  PlatformDocumentReviewDecision,
  PlatformDocumentSlotStatus,
} from "../platform-private-documents.ts";
import { PROFILE_FIELDS } from "../student-profile-fields.ts";

export function studentProfileFieldState(value: string): string | null {
  const labels: Record<string, string> = {
    extracted: "Предложение", needs_review: "Требует проверки",
    conflict: "Источники расходятся", confirmed: "Подтверждено",
  };
  return Object.hasOwn(labels, value) ? labels[value] : null;
}

export function studentProfileProposalState(value: string): string | null {
  const labels: Record<string, string> = {
    pending: "Ожидает решения", accepted: "Принято", rejected: "Отклонено",
  };
  return Object.hasOwn(labels, value) ? labels[value] : null;
}

export function studentProfileFieldActionMessage(value: string): string | null {
  const labels: Record<string, string> = {
    saved: "Решение сохранено.",
    invalid: "Проверьте значение и повторите сохранение. Для пустого значения есть отдельное подтверждение.",
    forbidden: "Изменение анкеты недоступно. Проверьте доступ к делу.",
    stale: "Анкета изменилась. Обновите её и сверьте актуальное значение. Ваши правки сохранены на экране.",
    request_conflict: "Предыдущий запрос уже использован. Проверьте значение и повторите сохранение.",
    source_unavailable: "Исходная версия документа сейчас недоступна. Проверьте источник перед повторным подтверждением.",
    unavailable: "Результат сохранения не подтверждён. Повторите без изменений, чтобы проверить результат запроса.",
  };
  return Object.hasOwn(labels, value) ? labels[value] : null;
}

export function studentProfileExportMessage(value: string): string | null {
  const labels: Record<string, string> = {
    pending: "Готовим файл… Не закрывайте страницу.",
    downloaded: "Файл готов. Скачивание начато.",
    unsaved: "Сначала сохраните или отмените правки полей. В файл должны попасть ваши актуальные решения.",
    saving: "Дождитесь завершения сохранения анкеты.",
    awaiting_snapshot: "Обновляем сохранённую анкету. Если ожидание затянулось, обновите анкету кнопкой ниже.",
    save_unconfirmed: "Результат последнего сохранения не подтверждён. Сначала проверьте его повторным сохранением без изменений.",
    draft_invalid: "Для черновика исправьте формат или длину уже подтверждённых полей.",
    unavailable_access: "Скачивание анкеты в этом режиме недоступно.",
    invalid_request: "Не удалось начать скачивание. Обновите анкету и попробуйте снова.",
    authentication_required: "Войдите в EVO заново, чтобы скачать анкету. Не закрывайте страницу с несохранёнными правками.",
    forbidden: "Скачивание недоступно. Проверьте доступ к делу.",
    access_changed: "Доступ к делу изменился. Обновите анкету и проверьте права на скачивание.",
    profile_changed: "Анкета изменилась. Обновите её и проверьте поля перед новым скачиванием. Ваши правки останутся на экране.",
    request_conflict: "Эта попытка уже использована. Проверьте анкету и начните новое скачивание кнопкой.",
    export_request_pending: "Предыдущая попытка ещё обрабатывается. Файл пока не получен; автоматического повтора не будет.",
    export_request_completed: "Эта попытка завершена. Для нового файла нажмите кнопку скачивания ещё раз.",
    profile_not_ready: "Исправьте указанные поля перед скачиванием.",
    export_unavailable: "Не удалось получить файл. Проверьте подключение и начните новую попытку кнопкой скачивания.",
    template_unavailable: "Шаблон анкеты временно недоступен. Попробуйте скачать позже.",
    render_failed: "Не удалось сформировать файл. Попробуйте скачать позже.",
  };
  return Object.hasOwn(labels, value) ? labels[value] : null;
}

export function studentProfileExportIssue(value: string): string | null {
  const labels: Record<string, string> = {
    missing: "заполните обязательное поле",
    unconfirmed: "проверьте и подтвердите значение",
    conflict: "выберите верное значение из источников",
    invalid: "проверьте формат и длину значения",
  };
  return Object.hasOwn(labels, value) ? labels[value] : null;
}

export const studentProfileFiles = {
  title: "Файлы анкеты", ready: "Анкета готова к финальному файлу", notReady: "Финальная анкета пока не готова",
  createFinal: "Сформировать финальную анкету", createDraft: "Сформировать черновик",
  explanation: "Формирование сохраняет отдельный файл. Затем его можно скачивать повторно без пересоздания.",
  draftExplanation: "В черновик попадут только подтверждённые поля с отметкой «Черновик».",
  refresh: "Обновить историю", refreshProfile: "Обновить анкету и историю", retry: "Повторить тот же запрос",
  reconcile: "Проверить сохранение", retryReconcile: "Повторить проверку", download: "Скачать файл",
  history: "Сохранённые файлы", older: "Более ранние файлы", empty: "Сохранённых файлов пока нет.",
  historical: "Предыдущая версия анкеты", current: "Текущая версия анкеты", draft: "Черновик", final: "Финальная анкета",
  review: "Что проверить перед формированием", noDownload: "Скачивание этого файла сейчас недоступно.",
  universityForm: "Бланк университета", filled: "Заполнен",
  formHistorical: "Предыдущая версия бланка или данных", formCurrent: "Актуальные бланк и данные",
} as const;

export const universityFormExport = {
  title: "Бланк университета",
  explanation: "Выберите заявление и опубликованный бланк. EVO заполнит его подтверждёнными данными анкеты и сохранит в общей истории файлов.",
  application: "Заявление", chooseApplication: "Выберите заявление", form: "Опубликованный бланк", chooseForm: "Выберите бланк",
  noApplications: "В деле пока нет заявлений. Добавьте заявление в разделе поступления, затем обновите страницу.",
  noCatalog: "Заявление не связано с университетом из каталога. Укажите эту связь в заявлении, затем обновите список.",
  noForms: "Для этого университета пока нет опубликованных бланков. Попросите ответственного сотрудника проверить и опубликовать бланк.",
  noMoreForms: "На этой странице бланков нет. Вернитесь к началу списка или обновите его.",
  loading: "Загружаем опубликованные бланки…", checking: "Проверяем выбранный бланк и версию анкеты…",
  loadFailed: "Не удалось загрузить бланки. Проверьте подключение и повторите загрузку.",
  refresh: "Обновить список бланков", retry: "Повторить загрузку", next: "Следующие бланки", first: "К началу списка",
  mappingChanged: "Публикация бланка изменилась. Обновите список и выберите актуальный бланк.",
  profileChanged: "Версия анкеты изменилась. Обновите анкету и историю перед формированием.",
  profileMissing: "Сохранённая анкета сейчас недоступна. Обновите анкету и историю.",
  createFinal: "Сформировать заполненный бланк", createDraft: "Черновик бланка",
  ready: "Проверим обязательные поля выбранного бланка при формировании. Незаполненные поля общей анкеты, не нужные этому бланку, не мешают.",
  draft: "Черновик содержит только подтверждённые данные и отметку «Черновик». Подпись, согласие и фото заполняются вручную.",
  uncertain: "Сначала проверьте исходную попытку кнопкой «Повторить тот же запрос» выше. Новое формирование пока недоступно.",
} as const;

export function studentProfileFileState(value: string): string | null {
  const labels: Record<string, string> = {
    pending: "Формирование не завершено", stored_unverified: "Файл ожидает проверки сохранения",
    ready: "Сохранён", unknown: "Сохранение пока не подтверждено", failed: "Файл не сформирован",
  };
  return Object.hasOwn(labels, value) ? labels[value] : null;
}

export function studentProfileFileMessage(value: string): string | null {
  const labels: Record<string, string> = {
    loading: "Загружаем историю файлов…", creating: "Формируем и сохраняем файл… Не закрывайте страницу.",
    reconciling: "Проверяем сохранённый файл…", downloading: "Получаем сохранённый файл…",
    downloaded: "Скачивание сохранённого файла начато.", ready: "Файл сохранён. Теперь его можно скачать.",
    pending: "Запрос сохранён, но файл ещё не готов. Проверьте сохранение кнопкой в истории. Автоматического повтора не будет.",
    unknown: "Ответ не подтверждён. Повторите тот же запрос: EVO проверит исходную попытку, не создавая новую.",
    unresolved: "В истории есть незавершённое формирование. Проверьте его сохранение; новый файл создаётся только отдельной командой.",
    workspace_changed: "Анкета изменилась. Обновите анкету и историю перед формированием. Правки на экране останутся.",
    source_changed: "Данные изменились. Обновите анкету и историю, затем проверьте поля.",
    source_unavailable: "Один из источников сейчас недоступен. Проверьте документы дела.",
    request_conflict: "Запрос не совпал с исходной попыткой. Обновите историю перед новым формированием.",
    export_unavailable: "Не удалось подтвердить результат. Проверьте подключение и используйте предложенную проверку.",
    artifact_pending: "Файл ещё не готов. Проверьте исходную попытку, не создавая новую.",
    template_unavailable: "Шаблон временно недоступен. Файл не сформирован.",
    integrity_failed: "Проверка файла не пройдена. Скачивание остановлено; проверьте сохранение.",
    export_failed: "Файл не сформирован. Проверьте анкету перед новой попыткой.",
    storage_unavailable: "Хранилище временно недоступно. Сохранение файла пока не подтверждено.",
    invalid_request: "Не удалось принять запрос. Обновите анкету и историю.",
    profile_not_ready: "Проверьте поля анкеты перед формированием файла.",
    form_not_ready: "Проверьте обязательные поля и настройку бланка перед заполнением.",
  };
  return Object.hasOwn(labels, value) ? labels[value] : studentProfileExportMessage(value);
}

/** Coverage conflicts are operational instructions, never raw database keys. */
export function coverageConflictLabel(value: string): string | null {
  const labels: Record<string, string> = {
    assignment_changed: "Назначение куратора изменилось. Проверьте актуального владельца дела.",
    original_curator_unavailable: "Прежний куратор сейчас недоступен для возврата.",
    task_reassigned: "Исполнителя задачи меняли отдельно. Сначала согласуйте её возврат.",
    original_assignee_unavailable: "Прежний исполнитель задачи сейчас недоступен.",
    unrelated_assignee: "Задача назначена другому куратору. Сначала проверьте исполнителя.",
  };
  return Object.hasOwn(labels, value) ? labels[value] : null;
}

/** Каноническая стадия `platform` sales workflow. */
const LEAD_STAGE: Record<string, string> = {
  new: "новый",
  contacting: "связались",
  qualified: "квалифицирован",
  meeting_scheduled: "встреча назначена",
  meeting_completed: "встреча проведена",
  potential: "потенциальный клиент",
};

/** Канонический статус `platform.university_applications`. */
const APPLICATION_STATUS: Record<string, string> = {
  preparation: "готовится",
  ready: "готова к подаче",
  submitted: "подана",
  under_review: "на рассмотрении",
  offer: "получен оффер",
  rejected: "отказ вуза",
  enrolled: "зачислен",
  withdrawn: "отозвана",
  closed: "закрыта",
};

/** Канонический статус `platform.visa_cases`. */
const VISA_STATUS: Record<string, string> = {
  not_required: "не требуется",
  not_started: "не начата",
  docs: "собираются документы",
  appointment: "назначена запись",
  submitted: "подана",
  approved: "одобрена",
  rejected: "отказ",
  closed: "закрыта",
};

/** Human labels for supported visa display kinds. */
const VISA_KIND: Record<string, string> = {
  visa_case: "Визовое дело",
  "Визовое дело": "Визовое дело",
};

/** Канонический статус `platform.student_cases`. */
const CASE_STATUS: Record<string, string> = {
  pending: "ожидает начала",
  active: "в работе",
  closed: "закрыт",
};

/**
 * Published OZO lifecycle plus its two pre-lifecycle bridge states. The
 * database column deliberately remains non-empty free text, so other valid
 * values use one neutral Student-safe label below instead of leaking a key.
 */
const STUDENT_OPERATIONAL_STAGE: Record<string, string> = {
  contract_confirmed: "договор подтверждён",
  admissions_handoff: "передано в приёмную",
  intake: "приём дела",
  profile_and_route: "выбор программы",
  documents: "сбор документов",
  applications: "подача через партнёра",
  decisions: "решения университетов",
  visa_and_predeparture: "виза и подготовка к отъезду",
  arrival_and_adaptation: "поездка и прибытие",
  completed: "поступление завершено",
  closed: "дело закрыто",
};

const CUSTOM_STUDENT_OPERATIONAL_STAGE = "индивидуальный этап сопровождения";

/**
 * OTH-1 «Воронка поступления» — куратор-борд. `pipeline_stage`
 * (`platform.student_cases`, миграция 186) сознательно отдельный от
 * `operational_stage` выше: это позиция карточки на доске, а не факт-гейтед
 * этап плейбука. Девять ключей — фиксированный `CHECK` в БД, порядок ниже —
 * порядок колонок (сперва вкладка «Поступление», потом «Виза и выезд»).
 */
const ADMISSIONS_PIPELINE_STAGE: Record<string, string> = {
  new: "Новые",
  shortlist: "Подбор вузов",
  documents: "Документы",
  ready_to_submit: "Готовы к подаче",
  awaiting_decision: "Ожидаем решения",
  confirmed: "Поступление подтверждено",
  visa: "Оформление визы",
  predeparture: "Подготовка к выезду",
  arrived: "Прибыл",
};

const ADMISSIONS_PIPELINE_TAB: Record<"admission" | "visa", string> = {
  admission: "Поступление",
  visa: "Виза и выезд",
};

// Plan §9: «Не загружен / На проверке / Нужно исправить / Принят». The
// server enum keeps its fifth, honest state («Отклонён») — the plan's list
// names the common path, not an exhaustive prohibition (unified workflow S6).
const DOCUMENT_SLOT_STATUS: Record<PlatformDocumentSlotStatus, string> = {
  required: "Не загружен",
  submitted: "На проверке",
  approved: "Принят",
  correction_required: "Нужно исправить",
  rejected: "Отклонён",
};

// Same three words as the slot status above («принят» / «нужно исправить» /
// «отклонён»), lowercase: this dictionary is also read mid-sentence
// («Документ принят · …» in ProfileDocumentsClient.tsx), where a
// mid-sentence capital would misread as a typo, not emphasis.
const DOCUMENT_REVIEW_DECISION: Record<PlatformDocumentReviewDecision, string> = {
  approved: "принят",
  correction_required: "нужно исправить",
  rejected: "отклонён",
};

const PAYMENT_OBLIGATION_STATUS: Record<PlatformObligationStatus, string> = {
  pending: "ожидает оплаты",
  partially_paid: "оплачено частично",
  paid: "оплачено",
  overdue: "просрочено",
};

const PAYMENT_OBLIGATION_CATEGORY: Record<PlatformObligationCategory, string> = {
  evo_service_fee: "услуги EVO",
  third_party_cost: "сторонние расходы",
};

/**
 * Каноническое состояние `platform.case_tasks`.
 *
 * `overdue` в базе нет — это открытая задача, у которой срок уже прошёл.
 * Слово всё равно живёт здесь: состояния одной и той же задачи, разъехавшиеся
 * по двум местам, — это и есть второй словарь.
 */
const TASK_STATUS: Record<string, string> = {
  open: "в работе",
  in_progress: "в работе",
  blocked: "заблокирована",
  done: "выполнена",
  completed: "выполнена",
  cancelled: "отменена",
  overdue: "просрочена",
};

/** Product-level document state. The profile intentionally has only two. */
export type DocumentPresence = "absent" | "present";

const DOCUMENT_PRESENCE: Record<DocumentPresence, string> = {
  absent: "нет",
  present: "есть",
};

/** Canonical finance-stop target; labels are shared by input and read views. */
const FINANCE_BLOCKED_ACTION = {
  application_submission: "Подача заявки в университет",
  document_processing: "Обработка документов",
  visa_submission: "Подача на визу",
  case_progression: "Дальнейшее движение дела",
} as const;

export const financeBlockedActionOptions = Object.entries(FINANCE_BLOCKED_ACTION).map(
  ([value, label]) => ({ value, label }),
);

/**
 * Страна заявки: код ISO-3166-1 alpha-2 → русское название. Здесь только
 * шесть стран, с которыми работает бизнес (см. frontend-roadmap,
 * «Требования под страну и программу»). Неизвестный код не рисуется:
 * `lookup` вернёт `null`, и вызывающий ничего не показывает.
 */
const COUNTRY: Record<string, string> = {
  CN: "Китай",
  MY: "Малайзия",
  AE: "ОАЭ",
  TR: "Турция",
  IT: "Италия",
  CZ: "Чехия",
};

/**
 * Ступень обучения университетской заявки: машинный ключ → слово. Ключи —
 * канонический словарь продукта; в схеме второго словаря нет, колонка —
 * тот же свободный TEXT, что и `student_cases.target_degree`. Неизвестный
 * ключ не рисуется.
 */
const DEGREE: Record<string, string> = {
  foundation: "Фаундейшн",
  language: "Языковые курсы",
  bachelor: "Бакалавриат",
  master: "Магистратура",
  phd: "Докторантура",
};

/** Роль: три фиксированные роли EVO. */
const ROLE: Record<string, string> = {
  admin: "администратор",
  sales: "продажи",
  admissions: "приёмная",
};

/** Откуда пришёл лид; source keys are still an open product dictionary. */
const SOURCE: Record<string, string> = {
  whatsapp: "WhatsApp",
  website: "сайт",
  platform_application: "платформа",
  referral: "по рекомендации",
  office: "встреча в офисе",
  phone_call: "звонок",
  other: "другой источник",
};

/**
 * Событие канонического audit journal, вида `объект.действие`.
 *
 * Собирается из двух половин, а не из полного списка: полных строк два
 * десятка, они множатся, и забытая строка утекла бы на экран сырым ключом.
 */
type Gender = "m" | "f" | "n";

const EVENT_OBJECT: Record<string, Readonly<{ word: string; gender: Gender }>> = {
  lead: { word: "Лид", gender: "m" },
  sales_lead: { word: "Лид", gender: "m" },
  student_case: { word: "Дело", gender: "n" },
  application: { word: "Заявка", gender: "f" },
  visa_milestone: { word: "Визовая веха", gender: "f" },
  task: { word: "Задача", gender: "f" },
  message: { word: "Сообщение", gender: "n" },
  conversation: { word: "Диалог", gender: "m" },
  finance_stop: { word: "Финансовый стоп", gender: "m" },
  handoff: { word: "Передача в приёмную", gender: "f" },
  sales_admissions: { word: "Передача в приёмную", gender: "f" },
  gate_evidence: { word: "Основание передачи", gender: "n" },
  ai_proposal: { word: "Предложение ИИ", gender: "n" },
};

/**
 * Глагол в трёх родах.
 *
 * Без этого получается «Задача заведён»: склейка объекта и глагола выглядит
 * дешёвым приёмом ровно до первого женского рода. Полный список строк вида
 * «объект.действие» держать нельзя — их два десятка и они множатся, а забытая
 * строка утечёт на экран сырым ключом.
 */
const EVENT_VERB: Record<string, Readonly<{ m: string; f: string; n: string }> | string> = {
  created: { m: "заведён", f: "заведена", n: "заведено" },
  activated: { m: "активирован", f: "активирована", n: "активировано" },
  completed: { m: "выполнен", f: "выполнена", n: "выполнено" },
  cancelled: { m: "отменён", f: "отменена", n: "отменено" },
  received: { m: "получен", f: "получена", n: "получено" },
  asserted: { m: "поставлен", f: "поставлена", n: "поставлено" },
  released: { m: "снят", f: "снята", n: "снято" },
  handed_off: { m: "выполнен", f: "выполнена", n: "выполнено" },
  handoff_override: { m: "выполнен в обход", f: "выполнена в обход", n: "выполнено в обход" },
  ownership_transferred: { m: "передан другой роли", f: "передана другой роли", n: "передано другой роли" },
  // Эти не согласуются с родом: подлежащее в них своё.
  workflow_updated: "— стадия изменена",
  next_action_updated: "— следующее действие изменено",
};

const lookup = (table: Record<string, string>, value: string | null | undefined) =>
  value == null ? null : (table[value] ?? null);

export const leadStage = (v: string | null | undefined) => lookup(LEAD_STAGE, v);
export const applicationStatus = (v: string | null | undefined) => lookup(APPLICATION_STATUS, v);
export function allDayDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  return `${match[3]}.${match[2]}.${match[1]}`;
}
export const visaStatus = (v: string | null | undefined) => lookup(VISA_STATUS, v);
export const visaKind = (v: string | null | undefined) => lookup(VISA_KIND, v);
export const caseStatus = (v: string | null | undefined) => lookup(CASE_STATUS, v);
export function studentOperationalStage(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return lookup(STUDENT_OPERATIONAL_STAGE, normalized) ??
    CUSTOM_STUDENT_OPERATIONAL_STAGE;
}
export const taskStatus = (v: string | null | undefined) => lookup(TASK_STATUS, v);
export const admissionsPipelineStage = (v: string | null | undefined) =>
  lookup(ADMISSIONS_PIPELINE_STAGE, v);
export const admissionsPipelineTab = (v: "admission" | "visa") => ADMISSIONS_PIPELINE_TAB[v];
export const documentPresence = (v: DocumentPresence) => DOCUMENT_PRESENCE[v];
export const documentSlotStatus = (v: string | null | undefined) =>
  lookup(DOCUMENT_SLOT_STATUS, v);
export const documentReviewDecision = (v: string | null | undefined) =>
  lookup(DOCUMENT_REVIEW_DECISION, v);
export const paymentObligationStatus = (v: string | null | undefined) =>
  lookup(PAYMENT_OBLIGATION_STATUS, v);
export const paymentObligationCategory = (v: string | null | undefined) =>
  lookup(PAYMENT_OBLIGATION_CATEGORY, v);
export const financeBlockedAction = (v: string | null | undefined) =>
  lookup(FINANCE_BLOCKED_ACTION, v);
export const country = (v: string | null | undefined) => lookup(COUNTRY, v);
export const degree = (v: string | null | undefined) => lookup(DEGREE, v);
export const role = (v: string | null | undefined) => lookup(ROLE, v);
export const source = (v: string | null | undefined) => lookup(SOURCE, v);

/** «application.created» → «Заявка заведена». Неизвестное — `null`. */
export function eventLabel(transition: string | null | undefined): string | null {
  if (!transition) return null;
  const dot = transition.indexOf(".");
  if (dot < 0) return null;
  const object = EVENT_OBJECT[transition.slice(0, dot)];
  if (!object) return null;
  const verb = EVENT_VERB[transition.slice(dot + 1)];
  if (!verb) return object.word;
  return typeof verb === "string"
    ? `${object.word} ${verb}`
    : `${object.word} ${verb[object.gender]}`;
}

export function personState(input: {
  hasCase: boolean;
  caseStatus: string | null;
  leadStage: string | null;
}): string {
  // Два состояния человека и всё. Стадия живёт в воронке, где по ней
  // работают; в шапке профиля она ничего не решает.
  return input.hasCase ? "Студент" : "Лид";
}

/**
 * Ступени воронки поступления.
 *
 * Это не перевод ключа базы, а одно слово на одну величину. Оно живёт здесь по
 * той же причине, что и остальные: на главной та же величина стоит в трёх
 * местах — на карточке, внутри фигуры и в легенде графика, — и три раза была
 * названа по-разному («Передано в приёмную», «Переданы», «Переданы»). Три
 * слова читаются как три величины.
 *
 * Слова короткие намеренно: в узкой колонке подпись стоит слева от фигуры и
 * длиннее ~170 единиц заезжает на саму ступень.
 *
 * «Дошли до заявки» считает людей, а не заявки: у одного кейса заявок бывает
 * несколько, и счёт заявок вылез бы за верхнюю ступень воронки.
 */
export const FUNNEL_STEP = {
  leads: "Лиды",
  qualified: "Квалифицированы",
  handed: "Переданы",
} as const;

/* ------------------------------------------------------------------ */

/** Роль с заглавной — для подписей в интерфейсе (рельс, access-denied). */
const ROLE_TITLE: Record<string, string> = {
  admin: "Администратор",
  sales: "Продажи",
  admissions: "Приёмная",
};
export const roleTitle = (v: string | null | undefined) => lookup(ROLE_TITLE, v);

/**
 * Статусы контура договора: шаблон (draft/approved/retired), артефакты
 * (draft/approved/rejected) и пункты постдоговорного чек-листа.
 */
const CONTRACT_STATUS: Record<string, string> = {
  approved: "Утверждён",
  blocked: "Заблокирован",
  delivered: "Выполнен",
  draft: "Черновик",
  in_progress: "В работе",
  open: "Открыт",
  rejected: "Отклонён",
  retired: "Снят",
};
export const contractStatus = (v: string | null | undefined) =>
  lookup(CONTRACT_STATUS, v);

/**
 * Слова журнала действий (безопасный аудит платформы).
 *
 * Ключи — канонические allowlist-ы аудита, и `satisfies` требует полноты:
 * пропущенный ключ — ошибка сборки, а не сырая строка на экране. Если во
 * времени выполнения всё же придёт неизвестное действие, строка не рисуется
 * и попадает в счёт «без названия» внизу списка.
 */
const JOURNAL_EVENT_WORD: Readonly<Record<string, string>> = {
  "lead.manual.create": "Лид добавлен вручную",
  "ai.control.set": "Управление ИИ изменено",
  "ai.draft.generate": "Черновик ответа ИИ создан",
  "ai.draft.language.resolve": "Определён язык черновика ИИ",
  "ai.draft.record": "Черновик ИИ записан",
  "ai.draft.request": "Запрошен черновик ИИ",
  "ai.draft.request.knowledge": "Подобраны знания для черновика ИИ",
  "ai.draft.review": "Черновик ИИ проверен",
  "ai.fact.record": "Факт ИИ записан",
  "ai.memory.record": "Память ИИ записана",
  "ai.qualification.record": "Квалификация ИИ записана",
  "ai.retrieval.preview": "Предпросмотр поиска ИИ",
  "application.create": "Заявка заведена",
  "application.details.update": "Данные заявки изменены",
  "application.status.change": "Статус заявки изменён",
  "audit.export": "Журнал выгружен",
  "autonomous.reply.control.set": "Автоответ переключён",
  "case.create": "Дело заведено",
  "case.curator.set": "Куратор дела назначен",
  "case.handoff.acknowledge": "Куратор принял передачу",
  "case.handoff.clarification": "Куратор запросил уточнение",
  "case.coverage.start": "Назначено временное замещение",
  "case.coverage.return": "Дело возвращено основному куратору",
  "case.handoff.create": "Передача дела оформлена",
  "case.lifecycle.change": "Состояние дела изменено",
  "case.route.change": "Маршрут дела изменён",
  "lead.admissions.handoff.completed": "Дело передано в сопровождение",
  "case.update.append": "Запись добавлена в дело",
  "catalog.import.batch.create": "Партия импорта каталога создана",
  "catalog.import.batch.review": "Партия импорта каталога проверена",
  "catalog.import.batch.validate": "Партия импорта каталога провалидирована",
  "catalog.import.candidate.stage": "Кандидат каталога подготовлен",
  "communication.conversation.create": "Диалог создан",
  "communication.conversation.link": "Диалог привязан",
  "communication.manual.authorize": "Ручная отправка разрешена",
  "communication.manual.send": "Сообщение отправлено вручную",
  "communication.manual.send.request": "Запрошена ручная отправка",
  "communication.message.record": "Сообщение записано",
  "communication.participant.record": "Участник диалога записан",
  "communication.provider.observe": "Снято состояние провайдера связи",
  "communication.waha.history.begin": "Сверка истории WhatsApp начата",
  "communication.waha.history.complete": "Сверка истории WhatsApp завершена",
  "communication.waha.history.pause": "Сверка истории WhatsApp приостановлена",
  "communication.waha.history.project": "История WhatsApp спроецирована",
  "communication.waha.project": "Сообщение WhatsApp спроецировано",
  "communication.waha.project.retry": "Повтор проекции WhatsApp",
  "contract.draft.generate": "Черновик договора создан",
  "contract.draft.review": "Черновик договора проверен",
  "contract.template.version.approve": "Версия шаблона договора утверждена",
  "contract.template.version.create": "Версия шаблона договора создана",
  "contract.template.version.retire": "Версия шаблона договора отозвана",
  "country.requirement.apply": "Требования страны применены",
  "country.requirement.source.link": "Источник требований страны привязан",
  "country.requirement.version.approve": "Версия требований страны утверждена",
  "country.requirement.version.create": "Версия требований страны создана",
  "country.requirement.version.retire": "Версия требований страны отозвана",
  "decision.backlog.create": "Решение отложено в бэклог",
  "decision.backlog.transition": "Отложенное решение переведено",
  "document.download.grant": "Выдан доступ к скачиванию документа",
  "document.download.sign.authorize": "Скачивание документа подписано",
  "document.requirement.create": "Требование к документам создано",
  "document.requirement.retire": "Требование к документам снято",
  "document.slot.application.link": "Документ привязан к заявке",
  "document.slot.application.unlink": "Документ отвязан от заявки",
  "document.slot.create": "Пункт документов создан",
  "document.slot.custom.create": "Свой пункт документов создан",
  "document.slot.metadata.change": "Пункт документов изменён",
  "document.slot.remove": "Пункт документов убран",
  "document.slot.visa.link": "Документ привязан к визе",
  "document.slot.visa.unlink": "Документ отвязан от визы",
  "document.upload.finalize": "Документ загружен",
  "document.upload.reserve": "Загрузка документа начата",
  "document.validation.attest": "Документ заверен",
  "document.version.record": "Версия документа записана",
  "document.version.review": "Версия документа проверена",
  "finance.obligation.create": "Платёжное обязательство создано",
  "finance.payment.record": "Платёж записан",
  "finance.stop.create": "Финансовый стоп поставлен",
  "finance.stop.resolve": "Финансовый стоп снят",
  "knowledge.chunkset.publish": "Фрагменты базы знаний опубликованы",
  "knowledge.version.publish": "Версия базы знаний опубликована",
  "knowledge.version.retire": "Версия базы знаний отозвана",
  "membership.permission.change": "Права сотрудника изменены",
  "membership.provision": "Сотрудник заведён",
  "membership.role.change": "Роль сотрудника изменена",
  "membership.scope.organization.assign": "Сотруднику назначена организация",
  "membership.scope.organization.revoke": "У сотрудника отозвана организация",
  "membership.status.change": "Статус сотрудника изменён",
  "staff.department.create": "Отдел создан",
  "staff.department.update": "Сведения об отделе изменены",
  "staff.department.archive": "Отдел перенесён в архив",
  "staff.department.restore": "Отдел восстановлен",
  "staff.organization.details.change": "Рабочие сведения сотрудника изменены",
  "messaging.integration.health.record": "Состояние мессенджера записано",
  "notification.consent.set": "Согласие на уведомления изменено",
  "notification.create": "Уведомление создано",
  "notification.read": "Уведомление прочитано",
  "organization.bootstrap": "Организация создана",
  "post.contract.item.update": "Пункт сопровождения изменён",
  "post.contract.items.seed": "Пункты сопровождения заведены",
  "post.contract.report.generate": "Отчёт сопровождения создан",
  "post.contract.report.review": "Отчёт сопровождения проверен",
  "rbac.bundle.upgrade": "Набор прав обновлён",
  "student.profile.upsert": "Анкета студента обновлена",
  "task.change": "Задача изменена",
  "task.create": "Задача создана",
  "visa.create": "Визовое дело создано",
  "visa.status.change": "Статус визы изменён",
  "workflow.contract.create": "Контракт процесса создан",
  "workflow.source.link": "Источник процесса привязан",
  "workflow.source.register": "Источник процесса зарегистрирован",
  "workflow.source.retire": "Источник процесса отозван",
  "workflow.source.review": "Источник процесса проверен",
  "workflow.version.approve": "Версия процесса утверждена",
  "workflow.version.create": "Версия процесса создана",
  "workflow.version.retire": "Версия процесса отозвана",
} satisfies Readonly<Record<PlatformAuditAction |
  "case.handoff.acknowledge" | "case.handoff.clarification" |
  "case.coverage.start" | "case.coverage.return" |
  "lead.admissions.handoff.completed" | "lead.manual.create", string>>;

const JOURNAL_OBJECT_WORD: Readonly<Record<string, string>> = {
  ai_draft: "Черновик ИИ",
  ai_draft_request: "Запрос черновика ИИ",
  ai_draft_request_knowledge_selection: "Подбор знаний для черновика ИИ",
  ai_retrieval_request: "Поисковый запрос ИИ",
  approved_knowledge_chunk_set: "Набор фрагментов базы знаний",
  approved_knowledge_version: "Версия базы знаний",
  audit_export: "Экспорт журнала",
  staff_department: "Отдел",
  staff_organizational_details: "Рабочие сведения сотрудника",
  case_task: "Задача по делу",
  catalog_import_batch: "Партия импорта каталога",
  catalog_import_candidate: "Кандидат импорта каталога",
  communication_conversation: "Диалог",
  communication_message: "Сообщение",
  contract_template_version: "Версия шаблона договора",
  conversation_ai_control: "Управление ИИ в диалоге",
  conversation_ai_fact: "Факт ИИ по диалогу",
  conversation_ai_memory: "Память ИИ по диалогу",
  conversation_ai_qualification: "Квалификация ИИ по диалогу",
  conversation_participant: "Участник диалога",
  country_requirement_version: "Версия требований страны",
  country_requirement_version_source: "Источник требований страны",
  decision_backlog: "Отложенное решение",
  document_requirement: "Требование к документам",
  document_slot: "Пункт чеклиста документов",
  document_version: "Версия документа",
  durable_work_item: "Фоновая задача",
  manual_send_authorization: "Разрешение ручной отправки",
  messaging_integration_health_event: "Состояние мессенджера",
  notification: "Уведомление",
  notification_consent: "Согласие на уведомления",
  organization: "Организация",
  organization_membership: "Членство в организации",
  payment_event: "Платёж",
  payment_obligation: "Платёжное обязательство",
  post_contract_item: "Пункт сопровождения",
  post_contract_item_set: "Набор пунктов сопровождения",
  post_contract_report: "Отчёт сопровождения",
  provider_reconciliation_event: "Сверка с провайдером",
  source_registry: "Реестр источников",
  stop_factor: "Финансовый стоп",
  student_case: "Дело студента",
  student_case_contract_draft: "Черновик договора",
  student_case_update: "Запись в деле",
  student_profile: "Анкета студента",
  university_application: "Заявка в вуз",
  visa_case: "Визовое дело",
  waha_history_reconciliation_run: "Сверка истории WhatsApp",
  workflow_contract: "Контракт процесса",
  workflow_contract_version: "Версия контракта процесса",
  workflow_contract_version_source: "Источник контракта процесса",
} satisfies Readonly<Record<PlatformAuditResourceType, string>>;

/** Категория актора безопасного журнала; персональных данных в нём нет. */
const JOURNAL_ACTOR_WORD: Readonly<Record<string, string>> = {
  Staff: "сотрудник",
  Service: "сервис",
  System: "система",
};

export const journalEvent = (v: string | null | undefined) =>
  lookup(JOURNAL_EVENT_WORD, v);

const TASK_CHANGE_FIELD: Readonly<Record<string, string>> = {
  status: "статус", priority: "приоритет", due_at: "срок", due_on: "срок",
  assignee_membership_id: "исполнитель",
};
export const taskChangeField = (v: string) => lookup(TASK_CHANGE_FIELD, v);
export const journalObject = (v: string | null | undefined) =>
  lookup(JOURNAL_OBJECT_WORD, v);
export const journalActor = (v: string | null | undefined) =>
  lookup(JOURNAL_ACTOR_WORD, v);
/** Separate curator response, never the completed Sales handoff lifecycle. */
export function handoffAcknowledgementLabel(value: string): string | null {
  const labels: Record<string, string> = {
    accepted: "Дело принято куратором",
    clarification_requested: "Нужно уточнение от Sales",
    declined: "Назначение отклонено куратором",
  };
  return Object.hasOwn(labels, value) ? labels[value] : null;
}

export function staffScopeLabel(value: string): string | null {
  return lookup({ own: "Свои записи", organization: "Вся организация", department: "Отдел", direction: "Направление", record: "Отдельная запись" }, value);
}

export function staffAuthConflictMessage(value: string | null | undefined): string | null {
  if (!value) return null;
  const messages: Record<string, string> = {
    legacy_access_review_required: "Приглашение создано до обновления ролей. Проверьте и сохраните согласованные права в этом запросе.",
    prepared_access_invalid: "Подготовленные права больше не подходят. Выберите действующие роли и области доступа.",
    role_version_changed: "Роль изменилась после подготовки приглашения. Проверьте её текущие действия и заново подтвердите права.",
    scope_changed: "Область доступа изменилась. Проверьте выбранный отдел или направление.",
    identity_already_linked: "Этот аккаунт уже связан с профилем. Сначала проверьте его принадлежность; смена ролей в приглашении этот конфликт не устранит.",
    recovery_target_unavailable: "Аккаунт сотрудника изменился или недоступен. Проверьте его карточку перед новым запросом восстановления.",
  };
  return Object.hasOwn(messages, value) ? messages[value] : "Настройки запроса требуют проверки администратора.";
}

export function staffAccessSummary(member: Readonly<{ systemRole: "admin" | "staff"; assignments: readonly Readonly<{ label: string }>[] }>): string {
  return member.systemRole === "admin" ? "Администратор" : [...new Set(member.assignments.map((assignment) => assignment.label))].join(", ") || "Роли не назначены";
}

export function staffDirectoryAccessSummary(
  member: Readonly<{ membershipId: string; version: number }>,
  access: Readonly<{ membershipId: string; accessVersion: number; systemRole: "admin" | "staff";
    assignments: readonly Readonly<{ label: string }>[] }> | undefined,
): string {
  if (!access || member.membershipId !== access.membershipId || member.version !== access.accessVersion) {
    return "Права изменились или недоступны. Обновите страницу.";
  }
  return staffAccessSummary(access);
}
export const documentRecognitionCopy = {
  caseTitle: "История извлечения по делу", caseEmpty: "В этом деле заданий пока нет.",
  caseDetail: "Здесь остаются задания по всем версиям, включая заменённые файлы. Новые запуски — в строке документа.",
  title: "Извлечение полей", loading: "Загружаем историю…", empty: "Для этой версии заданий пока нет.",
  extract: "Извлечь поля", retry: "Выбрать для нового запуска", send: "Подтвердить запуск", sending: "Сохраняем запрос…",
  charge: "Разрешаю обработать эту версию документа. Запуск может оплачиваться отдельно; поля проверю вручную.",
  retryCharge: "Это отдельная новая операция над той же версией с текущими моделью, настройками и бюджетом. Она может оплачиваться повторно.",
  accepted: "Запрос сохранён. Результат появится в истории; подтверждение полей остаётся за вами.",
  uncertain: "Ответ на запрос не получен. Он мог сохраниться; не создавайте новый запуск. Проверьте тот же запрос ниже.",
  replay: "Проверить исходный запрос", replayDetail: "Повторяем тот же ID и исходные данные, без нового запуска.",
  older: "Загрузить более ранние", latest: "К последним заданиям", refresh: "Обновить историю",
  review: "Проверить предложения в анкете", proposals: "Предложений", cleanup: "Файл у провайдера",
  unavailable: "История недоступна. Обновите её; новый запуск автоматически не выполняется.",
  profileMissing: "Сначала начните анкету. Документ не создаёт её автоматически.",
  readOnly: "Запуск недоступен с текущими правами или состоянием дела.",
  cancel: "Отменить выбор",
} as const;

export function documentRecognitionState(value: string): string | null {
  const labels: Record<string, string> = {
    queued: "В очереди", preflight: "Проверка документа", uploading: "Передача документа",
    file_processing: "Подготовка у провайдера", generating: "Извлечение полей", result_saved: "Результат сохранён",
    review_ready: "Предложения ждут проверки", failed: "Задание не выполнено", upload_unknown: "Исход передачи неизвестен",
    generation_unknown: "Исход извлечения неизвестен", publication_blocked: "Публикация предложений остановлена", cancelled: "Отменено",
  };
  return labels[value] ?? null;
}
export function documentRecognitionCleanup(value: string): string | null {
  const labels: Record<string, string> = {
    not_uploaded: "Передача не начиналась", pending: "Удаление ещё не подтверждено", deleting: "Проверяется удаление",
    confirmed_absent: "Отсутствие подтверждено", unknown: "Отсутствие не подтверждено — нужна проверка",
  };
  return labels[value] ?? null;
}
export function documentRecognitionError(value: string): string | null {
  const labels: Record<string, string> = {
    invalid_request: "Запрос некорректен. Обновите страницу.", unavailable: "Нет доступа или ответ недоступен.",
    profile_changed: "Анкета изменилась. Обновите страницу перед новым запуском.",
    request_conflict: "Исходный запрос не совпадает с сохранённым. Новый запуск не выполнен.",
    equivalent_job_active: "Для этой версии уже есть задание. Проверьте историю.",
    document_not_eligible: "Документ не подходит для извлечения.", profile_not_started: "Сначала начните анкету.",
    budget_exhausted: "Бюджет обработки исчерпан.", provider_not_configured: "Обработка документов ещё не настроена.",
    access_revoked: "Доступ изменился.", source_changed: "Исходная версия изменилась.", source_unavailable: "Исходный файл недоступен.",
    provider_rejected: "Провайдер отклонил обработку.", provider_unavailable: "Провайдер недоступен.",
    invalid_result: "Результат не прошёл проверку.", upload_unknown: "Исход передачи неизвестен.",
    generation_unknown: "Исход извлечения неизвестен.", publication_blocked: "Предложения не опубликованы.", cancelled: "Задание отменено.",
  };
  return labels[value] ?? null;
}
export const universityFormWorkspace = {
  title: "Бланки университета",
  back: "Вернуться к университету",
  add: "Добавить бланк",
  createTitle: "Новый бланк",
  name: "Название бланка",
  nameExample: "Например, заявление на поступление",
  createExplanation: "Сначала назовите бланк. На следующем шаге загрузите файл университета.",
  create: "Создать бланк",
  upload: "Загрузить файл",
  creating: "Создаём бланк…",
  cancel: "Отмена",
  saved: "Изменения сохранены.",
  createReason: "Добавление бланка университета",
  checkSaved: "Проверить список бланков",
  checkingExplanation: "Ответ сервера не получен. Бланк мог сохраниться — сначала проверьте список или повторите тот же запрос.",
  retry: "Повторить тот же запрос",
  empty: "Бланков пока нет",
  emptyExplanation: "Добавьте файл университета, чтобы настроить заполнение из анкеты студента.",
  choose: "Выберите бланк",
  chooseExplanation: "Откройте сохранённый бланк или добавьте новый.",
  draft: "Черновик",
  published: "Доступен для заполнения",
  archived: "В архиве",
  sourceChanged: "Сведения об университете изменились. Нужна новая версия бланка.",
  more: "Следующие бланки",
  first: "В начало списка",
  versions: "Версии файла",
  olderVersions: "Предыдущие версии",
  currentVersion: "Последняя версия",
  version: "Версия",
  newVersion: "Загрузить новую версию",
  file: "Файл университета",
  fileHint: "PDF или DOCX, не более 20 МБ.",
  selectedFile: "Выбран файл:",
  source: "Откуда получен бланк",
  sourceHint: "Ссылка на сайт университета или описание письма партнёра.",
  sourceDate: "Дата получения",
  sourceReason: "Добавление версии университетского бланка",
  uploading: "Загружаем и проверяем файл…",
  reserving: "Сохраняем сведения о версии…",
  inspectPending: "Ожидает загрузки или проверки",
  verified: "Файл проверен",
  openSource: "Открыть исходный файл",
  pendingExplanation: "Статус обновится автоматически. Можно вернуться к бланку позже.",
  unknownExplanation: "Не удалось подтвердить результат. Проверьте статус перед следующим действием.",
  fileInvalid: "Выберите PDF или DOCX размером до 20 МБ.",
  fileMismatch: "Это другой файл. Выберите исходный файл этой версии или создайте новую версию.",
  statusUnavailable: "Статус сейчас недоступен. Файл повторно не отправляется.",
  refreshStatus: "Проверить статус",
  reconcile: "Проверить завершение загрузки",
  cancelUpload: "Отменить загрузку",
  cancelConfirm: "Подтверждаю отмену загрузки этой версии",
  reconcileReason: "Проверка завершения загрузки университетского бланка",
  cancelReason: "Отмена загрузки университетского бланка",
  checking: "Проверяем…",
  reload: "Обновить страницу",
  readUnavailable: "Бланки сейчас недоступны. Попробуйте обновить страницу.",
} as const;

export function universityTemplateUploadState(value: string): string | null {
  const labels: Record<string, string> = {
    prepared: "Загрузка подготовлена", processing: "Проверяем файл", sealed: "Завершаем сохранение",
    verified: "Файл проверен", unknown: "Результат загрузки требует проверки",
    failed: "Загрузка не завершена", cancelled: "Загрузка отменена",
  };
  return Object.hasOwn(labels, value) ? labels[value] : null;
}

export const universityPdfMapping = {
  explanation: "Выделите место в бланке и выберите данные анкеты. Подписи, фото и согласия оставьте для заполнения вручную.",
  page: "Страница", pageView: "Исходный PDF с полями", zoom: "Масштаб", fit: "По ширине", field: "Поле",
  draw: "Выделить область", cancelDraw: "Отменить выделение", add: "Добавить поле без мыши",
  drawHint: "Проведите от одного угла поля до другого. На телефоне можно добавить поле кнопкой и настроить его положение.",
  empty: "Добавьте первое поле на странице бланка.", precision: "Точное положение и размер",
  precisionHint: "Координаты считаются от верхнего левого угла страницы, в пунктах PDF. Поле можно перетащить, нижний правый угол — потянуть для изменения размера. Стрелки сдвигают выбранное поле; Shift увеличивает шаг.",
  resize: "Изменить размер поля",
  x: "Слева", y: "Сверху", width: "Ширина", height: "Высота", cellLabel: "Количество клеток для букв", noCells: "Без клеток",
  remove: "Удалить поле", undo: "Отменить последнее изменение", reset: "Вернуть сохранённую настройку",
  bounds: "Поле должно помещаться на странице. Минимальный размер — 12 × 12 пунктов.",
  overlap: "Поля пересекаются. Сдвиньте одно из них или измените размер.",
  cells: "Проверьте число клеток: от 1 до 120, ширина каждой — не менее 5 пунктов.",
  noSpace: "Свободного места для стандартного поля нет. Выделите область нужного размера на странице.",
} as const;

export const universityFormManagement = {
  mappings: "Настройка заполнения",
  mappingVersion: "Настройка",
  mappingCount: "Полей для заполнения:",
  mappingEmpty: "Выберите поля анкеты для заполнения бланка.",
  mappingPending: "Ожидает проверки",
  mappingApproved: "Проверена",
  mappingRejected: "Нужны исправления",
  review: "Проверить настройку",
  reviewExplanation: "Сверьте выбранные поля с исходным бланком. Проверка относится только к этой сохранённой настройке.",
  approve: "Подтвердить настройку",
  reject: "Вернуть на исправление",
  decision: "Результат проверки",
  reviewConfirm: "Я сверил поля с исходным бланком",
  reviewReason: "Проверка настройки университетского бланка",
  reviewSaved: "Результат проверки сохранён.",
  publish: "Разрешить заполнение",
  publishExplanation: "Эта проверенная настройка станет доступна сотрудникам. Предыдущая версия сохранится в истории.",
  publishConfirm: "Использовать эту настройку для заполнения бланка",
  publishReason: "Публикация проверенной настройки университетского бланка",
  publishSaved: "Бланк доступен для заполнения.",
  archive: "Убрать бланк в архив",
  archiveExplanation: "Бланк перестанет предлагаться для нового заполнения. Файлы и история сохранятся.",
  archiveConfirm: "Убрать бланк из доступных для заполнения",
  archiveReason: "Архивирование университетского бланка",
  archiveSaved: "Бланк перемещён в архив.",
  comment: "Комментарий",
  saving: "Сохраняем…",
  next: "Открыть обновлённый бланк",
  history: "История настроек",
  latestMapping: "Последняя настройка",
  savedMapping: "Сохранённые поля и исходный бланк",
  older: "Предыдущие настройки",
  manual: "Вручную",
  optional: "Необязательное поле",
  required: "Обязательное поле",
  edit: "Настроить поля",
  editExplanation: "Выберите, какие данные анкеты подставлять в каждый фрагмент бланка. Подписи и согласия заполняются вручную.",
  sourceExcerpt: "Фрагменты исходного бланка",
  excerptExplanation: "Здесь показан текст для настройки полей, а не внешний вид готового документа.",
  sourceField: "Данные из анкеты",
  skip: "Не заполнять автоматически",
  combined: "Составные поля",
  context: "Контекст в бланке",
  excerptShortened: "Фрагмент сокращён; полный текст — в исходном файле.",
  blank: "Пустое место для заполнения",
  format: "Формат даты",
  dateFull: "Дата полностью",
  day: "День",
  month: "Месяц",
  year: "Год",
  previous: "Предыдущие фрагменты",
  following: "Следующие фрагменты",
  fragment: "Фрагмент",
  of: "из",
  previewLoading: "Открываем фрагменты…",
  previewUnavailable: "Не удалось открыть фрагменты. Настройка остаётся на экране; попробуйте ещё раз.",
  retryPreview: "Повторить открытие",
  saveMapping: "Сохранить настройку",
  mappingReason: "Настройка полей университетского бланка",
  mappingSaved: "Настройка сохранена. Следующий шаг — сверка полей с бланком.",
} as const;

export function universityFormSourceLabel(value: string): string | null {
  const combined: Record<string, string> = {
    full_name: "Имя и фамилия", surname_first_name: "Фамилия и имя",
    father_full_name: "Имя и фамилия отца", mother_full_name: "Имя и фамилия матери",
  };
  return Object.hasOwn(combined, value) ? combined[value] : PROFILE_FIELDS.find(field => field.key === value)?.label ?? null;
}

export function universityTemplateUploadFailure(value: string): string | null {
  const labels: Record<string, string> = {
    source_mismatch: "Файл не совпадает с выбранной версией.", malware_detected: "Файл отклонён проверкой безопасности.",
    scanner_unavailable: "Проверка безопасности временно недоступна.", template_not_eligible: "Этот файл нельзя использовать как бланк.",
    template_runtime_unavailable: "Проверка бланков временно недоступна.", storage_unavailable: "Хранилище временно недоступно.",
    storage_missing: "Сохранённый файл не найден.", access_changed: "Права доступа изменились.",
    source_changed: universityFormWorkspace.sourceChanged, archived: "Бланк перемещён в архив.",
    stale_revision: "Бланк изменился. Обновите страницу.", expired: "Время обработки истекло.",
    cancelled: "Загрузка отменена.", integrity_failed: "Проверка целостности файла не пройдена.",
  };
  return Object.hasOwn(labels, value) ? labels[value] : null;
}

export const partnerPacketExport = {
  title: "Пакеты документов партнёру",
  hint: "Состав фиксируется с версиями оригиналов и сохранённых форм. Подготовка и скачивание не означают отправку партнёру или подачу в университет.",
  cap: "ZIP до 50 МБ · до 50 файлов",
  sizeHint: "Итоговый размер проверим перед сохранением.",
  unavailable: "Не удалось загрузить пакеты. Обновите дело; файлы не изменены.",
  inactive: "Новые пакеты готовятся только в активном деле. История доступна ниже.",
  prerequisites: "Нужны заявление и хотя бы один принятый оригинал или сохранённая форма. Добавьте их в существующих разделах дела.",
  application: "Заявление", chooseApplication: "Выберите заявление",
  originals: "Принятые оригиналы", generated: "Сохранённые анкеты и бланки", noGenerated: "Для этого заявления сохранённых форм пока нет.",
  profile: "Анкета студента", form: "Бланк университета", draft: "Черновик", final: "Финальный",
  selected: "Выбрано", of50: "из 50", kb: "КБ", mb: "МБ", lessThanKb: "меньше 1 КБ", version: "версия",
  wrongApplication: "Форма относится к другому заявлению. Снимите выбор или вернитесь к его заявлению.",
  missing: "Выбранный файл больше недоступен в текущем списке. Обновите данные или явно снимите этот выбор.",
  removeMissing: "Снять выбор недоступных файлов", tooMany: "В одном пакете допускается не более 50 файлов.",
  tooLarge: "Выбранные файлы превышают 50 МБ. Уменьшите состав: файлы не будут пропущены автоматически.",
  emptySelection: "Выберите хотя бы один файл.",
  prepare: "Зафиксировать пакет", preparing: "Фиксируем состав…", retryPrepare: "Проверить сохранение", another: "Подготовить ещё один пакет",
  recent: "Последние 20 пакетов", noPackets: "Пакеты ещё не подготовлены.", preparedBy: "Подготовил",
  manifest: "Скачать состав пакета", originalDownload: "Скачать эту версию",
  privacy: "Каждая загрузка повторно проверяет доступ и безопасность файла. Открытая ссылка не создаётся.",
  legacy: "Чтобы сохранить ZIP, подготовьте новый состав.",
  draftInFinal: "В составе есть черновик формы. Для финального ZIP выберите финальную версию и подготовьте новый пакет.",
  createDraft: "Сохранить черновик ZIP", createFinal: "Сохранить финальный ZIP", retryCreate: "Проверить исходную попытку ZIP",
  history: "Сохранённые ZIP", emptyHistory: "Сохранённых ZIP пока нет.", refresh: "Обновить историю и составы",
  loading: "Загружаем историю ZIP…", historyFailed: "История ZIP недоступна. Обновите её перед новым сохранением.",
  pending: "Есть незавершённое сохранение ZIP. Сначала проверьте его состояние в истории.",
  package: "Пакет документов", items: "Файлов", historical: "Исторический состав", current: "Зафиксированный состав",
  errors: {
    package_not_ready: "Пакет пока нельзя сохранить. Обновите данные и проверьте состав.",
    package_too_large: "ZIP превышает 50 МБ. Уменьшите состав и подготовьте новый пакет.",
    package_storage_not_ready: "Сохранение ZIP временно недоступно. Попробуйте позже; новый файл не создан.",
    source_changed: "Состав или доступ к файлам изменился. Обновите данные и подготовьте новый пакет.",
    export_failed: "ZIP не сохранён. Проверьте состав, суммарный размер и доступность всех файлов.",
    invalid_request: "Проверьте выбранный пакет и режим ZIP, затем обновите данные.",
    form_not_ready: "Для финального ZIP нужны финальные сохранённые формы. Подготовьте новый состав.",
  } as Readonly<Record<string, string>>,
} as const;

export function universityFormActionMessage(value: string): string | null {
  const messages: Record<string, string> = {
    forbidden: "У вас нет доступа к изменению бланков этого университета.",
    invalid_request: "Проверьте название и заполнение формы.",
    stale_revision: "Бланк уже изменён. Обновите страницу перед следующим действием.",
    request_conflict: "Этот запрос уже использован для другого изменения. Проверьте сохранённый бланк.",
    source_changed: "Сведения об университете изменились. Сначала проверьте актуальную версию.",
    archived: "Бланк в архиве. Его история сохранена, но новые изменения недоступны.",
    not_inspected: "Проверка файла ещё не завершена. Дождитесь результата.",
    not_ready: "Бланк пока не готов к этому действию. Проверьте файл и настройку полей.",
    unavailable: universityFormWorkspace.checkingExplanation,
  };
  return Object.hasOwn(messages, value) ? messages[value] : null;
}

export const applicationUniversitySelector = {
  manual: "Ввести вручную",
  institution: "Университет",
  manualHint: "Без связи с каталогом бланки университета недоступны.",
  searchLabel: "Поиск университета",
  search: "Найти",
  selectLabel: "Университет из каталога",
  placeholder: "Выберите университет",
  loading: "Ищем университеты…",
  hint: "Найдите университет и выберите его из каталога.",
  empty: "Университеты не найдены. Попробуйте другое название.",
  retry: "Повторить поиск",
  previous: "Назад",
  next: "Далее",
  errors: {
    invalid: "Проверьте поисковый запрос: не более 100 символов.",
    forbidden: "Каталог недоступен с текущими правами.",
    unavailable: "Не удалось загрузить каталог. Повторите поиск.",
  },
} as const;

export const settingsStatusWords = {
  database: {
    ready: "доступна",
    failed: "ошибка подключения",
    unavailable: "состояние недоступно",
    missing: "нет данных",
    unverified: "не проверена",
    stale: "проверка устарела",
  },
  amoBlocked: {
    feature_disabled: "Синхронизация отключена.",
    configuration_missing: "Подключение не настроено.",
    configuration_invalid: "Параметры подключения некорректны.",
    routing_configuration_invalid: "Правила передачи данных настроены некорректно.",
    token_unavailable: "Доступ к аккаунту amoCRM не подтверждён.",
  },
} as const;

/**
 * S1's «кабинет до продажи»: a portal-activated `state='pending'` case with
 * no curator and no sale yet (plan §10, unified workflow S5). The overview
 * must not name a non-existent curator or fabricate a stage for it.
 */
export const portalPendingCabinet = {
  heading: "Сопровождение",
  managerNotice: "Менеджер свяжется с вами.",
  applicationHeading: "Ваша анкета",
  applicationHint: "Анкета, которую вы отправили и одобрила команда EVO.",
  applicationLink: "Открыть анкету",
} as const;

/**
 * Экраны-тупики оболочки: страница не найдена и неперехваченная ошибка
 * рендера. Один словарь на V3 и Student Portal — сообщение остаётся
 * человеческим и одинаковым в обоих мирах.
 */
export const chromeWords = {
  notFound: {
    eyebrow: "Страница не найдена",
    title: "Такой страницы здесь нет",
    staffText: "Ссылка устарела или адрес введён неверно. Проверьте адрес или вернитесь в свой раздел.",
    studentText: "Ссылка устарела или адрес введён неверно. Вернитесь в личный кабинет и откройте нужный раздел заново.",
    staffAction: "Вернуться в мой раздел",
    studentAction: "Перейти в «Поступление»",
  },
  error: {
    eyebrow: "Не удалось открыть экран",
    title: "Что-то пошло не так",
    staffText: "Попробуйте ещё раз. Если ошибка повторится, сообщите об этом в настройках или своему руководителю — введённое на этом экране не потеряно.",
    studentText: "Попробуйте ещё раз или откройте другой раздел через меню. Если ошибка повторится, сообщите куратору.",
    retry: "Попробовать снова",
    staffAction: "Вернуться в мой раздел",
    studentAction: "В личный кабинет",
  },
} as const;

export function settingsBlockedWahaDetail(status: string | undefined): string {
  switch (status) {
    case "WORKING": return "Актуальность проверки подключения не подтверждена.";
    case "SCAN_QR_CODE": return "Требуется подключение WhatsApp по QR-коду.";
    case "STARTING": return "Подключение запускается.";
    case "STOPPED": return "Подключение остановлено.";
    case "FAILED": return "Ошибка подключения.";
    default: return "Состояние подключения не подтверждено.";
  }
}
