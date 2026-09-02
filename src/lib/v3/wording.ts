/**
 * Единственное место, где машинное значение превращается в слово для человека.
 *
 * Правило V3: **ключ из базы не попадает на экран никогда.** Ни `handed_off`,
 * ни `draft`, ни `application.created`. Не потому что некрасиво, а потому что
 * ключ зависит от того, из какой таблицы его прочитали: у заявки в вуз в этом
 * же продукте два разных словаря статусов — канонический (`draft`) и
 * платформенный (`preparation`). Пока на экране человеческое слово, такое
 * расхождение видно; пока ключ — нет.
 *
 * Соответственно: **не добавляйте перевод по месту, в компоненте.** Второй
 * словарь разойдётся с первым, и никто не заметит. Добавляйте сюда.
 *
 * Возврат `null` означает «показывать нечего» — вызывающий просто ничего не
 * рисует. Сырой ключ не показывается даже как запасной вариант: это ровно тот
 * случай, ради которого файл и заведён.
 */

/** Стадия лида: `evo_leads.stage`. */
const LEAD_STAGE: Record<string, string> = {
  new: "новый",
  qualifying: "на квалификации",
  qualified: "квалифицирован",
  handoff_ready: "готов к передаче",
  handed_off: "передан в приёмную",
  disqualified: "отказ",
};

/** Статус заявки в вуз: `evo_university_applications.status`. */
const APPLICATION_STATUS: Record<string, string> = {
  draft: "не подана",
  submitted: "подана",
  accepted: "принят",
  rejected: "отказ вуза",
  withdrawn: "отозвана",
};

/** Статус визовой вехи: `evo_visa_milestones.status`. */
const VISA_STATUS: Record<string, string> = {
  pending: "не начата",
  in_progress: "в работе",
  completed: "готова",
  blocked: "заблокирована",
};

/** Вид визовой вехи: `evo_visa_milestones.milestone_kind`. */
const VISA_KIND: Record<string, string> = {
  document_preparation: "Подготовка документов",
  submission: "Подача",
  appointment: "Запись",
  biometrics: "Биометрия",
  interview: "Собеседование",
  decision: "Решение",
};

/** Статус кейса студента: `evo_student_cases.status`. */
const CASE_STATUS: Record<string, string> = {
  active: "в работе",
  paused: "на паузе",
  closed: "закрыт",
};

/** Роль: три фиксированные роли EVO. */
const ROLE: Record<string, string> = {
  admin: "администратор",
  sales: "продажи",
  admissions: "приёмная",
};

/** Откуда пришёл лид: `evo_leads.source`. */
const SOURCE: Record<string, string> = {
  whatsapp: "WhatsApp",
  website: "сайт",
  referral: "по рекомендации",
};

/**
 * Событие шины: `evo_business_events.transition`, вида `объект.действие`.
 *
 * Собирается из двух половин, а не из полного списка: полных строк два
 * десятка, они множатся, и забытая строка утекла бы на экран сырым ключом.
 */
const EVENT_OBJECT: Record<string, string> = {
  lead: "Лид",
  student_case: "Кейс",
  application: "Заявка",
  visa_milestone: "Визовая веха",
  task: "Задача",
  message: "Сообщение",
  conversation: "Диалог",
  finance_stop: "Финансовый стоп",
  sales_admissions: "Передача в приёмную",
  sales_lead: "Лид",
  gate_evidence: "Основание передачи",
  ai_proposal: "Предложение ИИ",
};

const EVENT_VERB: Record<string, string> = {
  created: "заведён",
  activated: "активирован",
  completed: "выполнена",
  cancelled: "отменена",
  received: "получено",
  asserted: "поставлен",
  released: "снят",
  handed_off: "выполнена",
  handoff_override: "выполнена в обход",
  workflow_updated: "стадия изменена",
  next_action_updated: "следующее действие изменено",
  ownership_transferred: "передан другой роли",
};

const lookup = (table: Record<string, string>, value: string | null | undefined) =>
  value == null ? null : (table[value] ?? null);

export const leadStage = (v: string | null | undefined) => lookup(LEAD_STAGE, v);
export const applicationStatus = (v: string | null | undefined) => lookup(APPLICATION_STATUS, v);
export const visaStatus = (v: string | null | undefined) => lookup(VISA_STATUS, v);
export const visaKind = (v: string | null | undefined) => lookup(VISA_KIND, v);
export const caseStatus = (v: string | null | undefined) => lookup(CASE_STATUS, v);
export const role = (v: string | null | undefined) => lookup(ROLE, v);
export const source = (v: string | null | undefined) => lookup(SOURCE, v);

/** «application.created» → «Заявка заведена». Неизвестное — `null`. */
export function eventLabel(transition: string | null | undefined): string | null {
  if (!transition) return null;
  const dot = transition.indexOf(".");
  if (dot < 0) return null;
  const object = EVENT_OBJECT[transition.slice(0, dot)];
  const verb = EVENT_VERB[transition.slice(dot + 1)];
  if (!object) return null;
  return verb ? `${object} ${verb}` : object;
}

/**
 * Одна строка состояния человека вместо россыпи пилюль.
 *
 * Раньше в шапке досье стояли четыре: статус кейса, стадия лида, роль-владелец
 * и источник. Три из них человека не описывают, а четвёртая — машинное слово.
 * Здесь остаётся одно предложение: кто он сейчас и что с ним происходит.
 */
export function personState(input: {
  hasCase: boolean;
  caseStatus: string | null;
  leadStage: string | null;
}): string {
  if (input.hasCase) {
    const status = caseStatus(input.caseStatus);
    return status && input.caseStatus !== "active" ? `Студент · ${status}` : "Студент";
  }
  const stage = leadStage(input.leadStage);
  return stage ? `Лид · ${stage}` : "Лид";
}
