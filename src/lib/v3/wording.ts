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
  referral: "по рекомендации",
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
  student_case: { word: "Кейс", gender: "m" },
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
export const visaStatus = (v: string | null | undefined) => lookup(VISA_STATUS, v);
export const visaKind = (v: string | null | undefined) => lookup(VISA_KIND, v);
export const caseStatus = (v: string | null | undefined) => lookup(CASE_STATUS, v);
export const taskStatus = (v: string | null | undefined) => lookup(TASK_STATUS, v);
export const documentPresence = (v: DocumentPresence) => DOCUMENT_PRESENCE[v];
export const financeBlockedAction = (v: string | null | undefined) =>
  lookup(FINANCE_BLOCKED_ACTION, v);
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
  handed: "Переданы",
} as const;
