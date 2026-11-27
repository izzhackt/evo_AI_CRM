/*
 * «ИИ-агенты»: досье лида и дела (миграция 382, инструменты get_lead_dossier и get_case_dossier).
 * Быстрые тесты без сети и базы. Запуск:
 *   node --conditions=react-server --experimental-strip-types --test tests/ai-agents-dossier.test.mjs
 *
 * Что проверяется:
 *  - слова досье в SQL (платформенная функция слов) построчно совпадают со словарями экранов: wording.ts, lead-channel-contract.ts,
 *    student-application-presentation.ts, study-countries.json (второго словаря нет);
 *  - таблица соответствия «этап процесса -> колонки доски» обратна к BOARD_TIMELINE_STAGE кабинета студента;
 *  - шаг пути («3 из 7, Малайзия») считается теми же правилами, что кабинет, и честно говорит «нет», когда его нет;
 *  - потолки размера, хук Postgres-прогона, состав преамбулы агентов.
 * Сам SQL (этапы, деньги тремя блоками, согласие, потолок на огромном деле) проверяет supabase/tests/platform_ai_agent_dossiers.sql.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { AI_AGENT_KEYS, AI_AGENT_TOOLS } from "../src/lib/ai-agents/contract.ts";
import { AI_AGENT_TOOL_GRANTS } from "../src/content/ai-agents/tool-grants.generated.ts";
import { attachDossierTimelineStep, dossierTimelineStep } from "../src/lib/ai-agents/dossier-timeline.ts";
import { AI_AGENT_PREAMBLE } from "../src/content/ai-agents/index.ts";
import { LEAD_CHANNELS, LEAD_CHANNEL_BASES } from "../src/lib/lead-channel-contract.ts";
import { ADMISSIONS_PIPELINE_STAGES } from "../src/lib/platform-admissions-pipeline-contract.ts";
import {
  BOARD_TIMELINE_STAGE,
  COUNTRY_TIMELINES,
  selectCountryTimeline,
  todayForTimeline,
  TIMELINE_STAGE_KEYS,
} from "../src/lib/portal/country-timeline.ts";
import { APPLICATION_LABELS } from "../src/lib/student-application-presentation.ts";
import { studyCountryName } from "../src/lib/study-countries.ts";
import {
  SALES_STAGE_TITLE,
  caseMoneyWords,
  closureWords,
  paymentObligationCategory,
  paymentObligationStatus,
  admissionsPipelineStage,
  applicationStatus,
  caseDegree,
  caseStatus,
  documentSlotStatus,
  studentOperationalStage,
  taskPriorityMark,
  taskStatus,
} from "../src/lib/v3/wording.ts";

const SQL = readFileSync(new URL("../supabase/migrations/382_platform_ai_agent_dossiers.sql", import.meta.url), "utf8");
const SUITE = readFileSync(new URL("../supabase/tests/platform_ai_agent_dossiers.sql", import.meta.url), "utf8");
const RUNNER = readFileSync(new URL("../scripts/test-runners/test-postgres-authorization.sh", import.meta.url), "utf8");

/** Строки `('вид', 'ключ', 'слово')` из тела функции слов. */
function wordRows() {
  const start = SQL.indexOf("CREATE FUNCTION platform_private.ai_agent_dossier_word(");
  assert.notEqual(start, -1);
  const body = SQL.slice(start, SQL.indexOf("\n$$;", start));
  const rows = [...body.matchAll(/^\s+\('([a-z_]+)', '([^']+)', '([^']+)'\),?$/gmu)].map(([, kind, key, word]) => ({ kind, key, word }));
  assert.ok(rows.length > 100, `слов в таблице: ${rows.length}`);
  return rows;
}
const rowsOf = (kind) => wordRows().filter((row) => row.kind === kind);
const asMap = (kind) => Object.fromEntries(rowsOf(kind).map((row) => [row.key, row.word]));

test("слова досье: этап продаж, процесс, колонка доски совпадают со словарём экранов построчно", () => {
  const { closed, ...working } = asMap("sales_stage");
  assert.deepEqual(working, { ...SALES_STAGE_TITLE }, "семь названий этапов продаж, те же, что у доски");
  assert.equal(closed, closureWords.lead.closed, "закрытый лид — слово «Закрыт» из окна закрытия");
  const processKeys = [...TIMELINE_STAGE_KEYS, "contract_confirmed", "admissions_handoff", "completed", "closed"].sort();
  assert.deepEqual(Object.keys(asMap("process_stage")).sort(), processKeys, "одиннадцать ключей процесса");
  for (const [key, word] of Object.entries(asMap("process_stage"))) assert.equal(studentOperationalStage(key), word, key);
  assert.deepEqual(Object.keys(asMap("board_column")).sort(), [...ADMISSIONS_PIPELINE_STAGES].sort(), "девять колонок доски");
  for (const [key, word] of Object.entries(asMap("board_column"))) assert.equal(admissionsPipelineStage(key), word, key);
  // Слово «индивидуальный этап сопровождения» — то, что wording.ts даёт ключу вне списка; SQL повторяет его в одном месте.
  assert.equal(studentOperationalStage("my_special_stage"), "индивидуальный этап сопровождения");
  assert.ok(SQL.includes("'индивидуальный этап сопровождения'"));
});

test("слова досье: канал «откуда узнал» и основание совпадают с lead-channel-contract.ts, статусы и слова — со словарём экранов", () => {
  assert.deepEqual(asMap("channel"), { ...LEAD_CHANNELS });
  assert.deepEqual(asMap("channel_basis"), { ...LEAD_CHANNEL_BASES });
  // Значения enum базы (document_slot_status, application_status, case_task_status, student_case_state) покрыты целиком.
  const documentKeys = ["required", "submitted", "approved", "correction_required", "rejected"];
  assert.deepEqual(Object.keys(asMap("document_status")).sort(), [...documentKeys].sort());
  for (const key of documentKeys) assert.equal(documentSlotStatus(key), asMap("document_status")[key], key);
  const applicationKeys = ["preparation", "ready", "submitted", "under_review", "offer", "rejected", "enrolled", "withdrawn", "closed"];
  assert.deepEqual(Object.keys(asMap("application_status")).sort(), [...applicationKeys].sort());
  for (const key of applicationKeys) assert.equal(applicationStatus(key), asMap("application_status")[key], key);
  const taskKeys = ["open", "in_progress", "blocked", "done", "cancelled"];
  assert.deepEqual(Object.keys(asMap("task_status")).sort(), [...taskKeys].sort());
  for (const key of taskKeys) assert.equal(taskStatus(key), asMap("task_status")[key], key);
  const caseKeys = ["pending", "active", "closed"];
  assert.deepEqual(Object.keys(asMap("case_state")).sort(), [...caseKeys].sort());
  for (const key of caseKeys) assert.equal(caseStatus(key), asMap("case_state")[key], key);
  for (const [key, word] of Object.entries(asMap("degree"))) assert.equal(caseDegree(key), word, key);
  assert.deepEqual(asMap("task_priority"), { urgent: taskPriorityMark("urgent") });
  // Деньги: статусы и категории обязательств и виды платежей — из словаря экранов, не из CASE в SQL.
  const statuses = asMap("obligation_status");
  assert.deepEqual(Object.keys(statuses).sort(), ["overdue", "paid", "partially_paid", "pending"]);
  for (const [key, word] of Object.entries(statuses)) assert.equal(paymentObligationStatus(key), word, key);
  const categories = asMap("obligation_category");
  assert.deepEqual(Object.keys(categories).sort(), ["evo_service_fee", "third_party_cost"]);
  for (const [key, word] of Object.entries(categories)) assert.equal(paymentObligationCategory(key), word, key);
  assert.equal(categories.third_party_cost, "сторонние расходы");
  assert.deepEqual(asMap("payment_event"), { payment: caseMoneyWords.pay.status.paid, refund: caseMoneyWords.pay.status.refund });
  // В телах сборщиков нет русских слов денег и статусов вне таблицы слов.
  const builders = SQL.slice(SQL.indexOf("CREATE FUNCTION platform_private.ai_agent_lead_dossier_build("), SQL.indexOf("CREATE FUNCTION platform_private.ai_agent_dossier_minimal("));
  for (const word of ["'услуги EVO'", "'просрочено'", "'оплачено'", "'платёж'", "'возврат'", "'расходы третьих сторон'", "'выигран'", "'проигран'", "'Закрыт'"]) {
    assert.ok(!builders.includes(word), `слово ${word} стоит вне таблицы слов`);
  }
});

test("слова досье: ответы анкеты — тот же словарь, что у анкеты на экране, целиком; страны направлений — как в списке продукта", () => {
  assert.deepEqual(asMap("answer"), { ...APPLICATION_LABELS });
  const directions = asMap("direction");
  for (const code of ["CN", "MY", "AE", "TR"]) assert.equal(directions[code], studyCountryName(code, "ru"), code);
  // В лидах Европа записана `EU`, в делах `EUROPE`: оба ключа дают одно слово.
  assert.equal(directions.EUROPE, "Европа");
  assert.equal(directions.EU, "Европа");
});

test("таблица «этап процесса -> колонки доски» обратна к BOARD_TIMELINE_STAGE кабинета студента", () => {
  const start = SQL.indexOf("CREATE FUNCTION platform_private.ai_agent_dossier_expected_boards(");
  const body = SQL.slice(start, SQL.indexOf("\n$$;", start));
  const sqlTable = Object.fromEntries(
    [...body.matchAll(/WHEN '([a-z_]+)' THEN ARRAY\[([^\]]+)\]/gu)].map(([, stage, list]) => [stage, [...list.matchAll(/'([a-z_]+)'/gu)].map((m) => m[1]).sort()]),
  );
  for (const stage of TIMELINE_STAGE_KEYS) {
    const boards = ADMISSIONS_PIPELINE_STAGES.filter((board) => BOARD_TIMELINE_STAGE[board] === stage).sort();
    assert.deepEqual(sqlTable[stage], boards, `${stage}: колонки кабинета и таблицы базы совпадают`);
  }
  // Этапы вне путей: до приёма и «завершено» — в соседнюю колонку; «закрыто» и любой иной — не сравниваются.
  assert.deepEqual(sqlTable.contract_confirmed, ["new"]);
  assert.deepEqual(sqlTable.admissions_handoff, ["new"]);
  assert.deepEqual(sqlTable.completed, ["arrived"]);
  assert.equal("closed" in sqlTable, false);
  assert.match(body, /ELSE NULL END/u);
  // Каждая колонка доски встречается хотя бы у одного этапа: расхождение не прячется за пропуском.
  const used = new Set(Object.values(sqlTable).flat());
  for (const board of ADMISSIONS_PIPELINE_STAGES) assert.ok(used.has(board), board);
  // Заголовок миграции описывает ту же таблицу.
  assert.match(SQL, /closed, пользовательский этап, пустой этап или колонка -> не сравниваются: stage_mismatch = null/u);
});

test("шаг пути: те же правила, что в кабинете студента: «3 из 7, Малайзия», колонка уточняет шаг, нет данных — null с причиной", () => {
  const my = (operational, board) => dossierTimelineStep({ country_code: "MY", operational_stage: operational, pipeline_stage: board });
  assert.equal(my("applications", "ready_to_submit").step.text, "3 из 7, Малайзия");
  assert.equal(my("intake", "new").step.position, 1);
  assert.equal(my("documents", "documents").step.position, 2);
  // Малайзия: «Виза» и «Билет, SEV, MDAC и жильё» делят этап, колонка доски различает их.
  assert.equal(my("visa_and_predeparture", "visa").step.position, 4);
  assert.equal(my("visa_and_predeparture", "confirmed").step.position, 4);
  assert.equal(my("visa_and_predeparture", "predeparture").step.position, 5);
  assert.equal(my("arrival_and_adaptation", "arrived").step.position, 6);
  const done = my("completed", "arrived").step;
  assert.equal(done.finished, true);
  assert.equal(done.position, done.of);
  assert.equal(my("applications", "ready_to_submit").step.finished, false);
  assert.equal(my("applications", "ready_to_submit").step.route, "country");
  assert.equal(my("applications", "ready_to_submit").step.title, COUNTRY_TIMELINES.my.steps[2].title.ru);
  // Маршрут выбирает selectCountryTimeline кабинета: неутверждённый путь страны стал бы общим маршрутом, и досье сказало бы об этом.
  for (const code of ["CN", "MY", "AE", "TR", "IT", "CZ"]) {
    const view = selectCountryTimeline(code, { today: todayForTimeline() });
    const step = dossierTimelineStep({ country_code: code, operational_stage: "documents", pipeline_stage: "documents" }).step;
    assert.equal(step.route, view.kind, code);
    assert.equal(step.of, view.steps.filter((item) => !item.optional).length, code);
    assert.equal(step.text.endsWith("(общий маршрут)"), view.kind === "general", code);
  }
  assert.equal(my("documents", "documents").step.route, "country");

  // Китай: три шага «документов», первый из них — текущий; в путях Китая восемь шагов.
  const cn = dossierTimelineStep({ country_code: "CN", operational_stage: "documents", pipeline_stage: "documents" }).step;
  assert.equal(cn.text, "2 из 8, Китай");
  // Шаги «по желанию» не входят в счёт: «из N» считает только обязательные.
  for (const code of ["CN", "MY", "AE", "TR", "IT", "CZ"]) {
    const regular = COUNTRY_TIMELINES[code.toLowerCase()].steps.filter((step) => step.optional !== true).length;
    const step = dossierTimelineStep({ country_code: code, operational_stage: "intake", pipeline_stage: "new" }).step;
    assert.equal(step.of, regular, code);
    assert.equal(step.position, 1, code);
  }

  for (const keys of [
    { country_code: null, operational_stage: "documents", pipeline_stage: "documents" },
    { country_code: "KZ", operational_stage: "documents", pipeline_stage: "documents" },
    { country_code: "MY", operational_stage: "my_special_stage", pipeline_stage: "new" },
    { country_code: "MY", operational_stage: "contract_confirmed", pipeline_stage: "new" },
    { country_code: "MY", operational_stage: "closed", pipeline_stage: "documents" },
    { country_code: "MY", operational_stage: null, pipeline_stage: null },
    null,
    "text",
  ]) {
    const result = dossierTimelineStep(keys);
    assert.equal(result.step, null, JSON.stringify(keys));
    assert.ok(typeof result.note === "string" && result.note.length > 10, JSON.stringify(keys));
  }
});

test("шаг пути подмешивается в ответ, не меняя остального; чужая форма ответа возвращается как есть", () => {
  const data = { case: { case_id: "x" }, timeline_step: null, keys: { country_code: "TR", operational_stage: "applications", pipeline_stage: "ready_to_submit" }, money: { a: 1 } };
  const merged = attachDossierTimelineStep(data);
  assert.equal(merged.timeline_step.country, "Турция");
  assert.deepEqual({ ...merged, timeline_step: null }, data, "кроме шага пути ничего не изменилось");
  assert.equal(data.timeline_step, null, "исходный объект не тронут");
  const none = attachDossierTimelineStep({ ...data, keys: { country_code: null } });
  assert.equal(none.timeline_step, null);
  assert.match(none.timeline_step_note, /не из шести/u);
  for (const odd of [null, undefined, 5, "s", [1], {}]) {
    const result = attachDossierTimelineStep(odd);
    if (odd === null || odd === undefined || typeof odd !== "object" || Array.isArray(odd)) assert.equal(result, odd);
    else assert.equal(result.timeline_step, null);
  }
});

test("потолки размера: 6 000 у лида, 11 500 в базе у дела (12 000 после шага пути); обе функции сжимают по уровням и называют пропущенное", () => {
  assert.match(SQL, /v_ceiling CONSTANT INTEGER := 6000/u);
  assert.match(SQL, /v_ceiling CONSTANT INTEGER := 11500/u);
  assert.ok(11_500 + 500 <= 12_000, "место под шаг пути");
  assert.match(SQL, /EXIT WHEN char_length\(v_out::TEXT\) <= v_ceiling OR v_level >= 4/u);
  assert.equal([...SQL.matchAll(/EXIT WHEN char_length\(v_out::TEXT\) <= v_ceiling OR v_level >= 4/gu)].length, 2);
  for (const key of ["'truncated'", "'omitted'", "'counts'"]) assert.ok(SQL.split(key).length >= 3, key);
  // Самый сжатый шаг короче потолка с запасом: пять документов, две задачи, без чата и заметок.
  assert.match(SQL, /\(ARRAY\[40, 25, 15, 8, 5\]\)\[p_level \+ 1\]/u);
  assert.match(SQL, /\(ARRAY\[10, 10, 6, 3, 0\]\)\[p_level \+ 1\]/u);
  assert.match(SQL, /\(ARRAY\[15, 15, 10, 5, 0\]\)\[p_level \+ 1\]/u);
});

test("досье не кладёт в ответ то, что запрещено: файлы, пути, версии, номера документов, полные контакты", () => {
  const forbiddenColumns = [
    /storage_(bucket|path)/u, /object_name/u, /declared_mime_type/u, /byte_size/u, /current_version_id/u, /document_versions/u,
    /passport/iu, /document_number/u, /iban|swift|bic\b/iu,
  ];
  const lead = SQL.slice(SQL.indexOf("CREATE FUNCTION platform_private.ai_agent_lead_dossier_build("), SQL.indexOf("CREATE FUNCTION platform_private.ai_agent_case_dossier_build("));
  const kase = SQL.slice(SQL.indexOf("CREATE FUNCTION platform_private.ai_agent_case_dossier_build("), SQL.indexOf("CREATE FUNCTION platform.ai_agent_tool_get_lead_dossier_v1("));
  for (const [name, text] of [["lead", lead], ["case", kase]]) {
    for (const pattern of forbiddenColumns) assert.doesNotMatch(text, pattern, `${name}: ${pattern}`);
    assert.equal([...text.matchAll(/\bc\.phone\b/gu)].length, [...text.matchAll(/ai_agent_mask_phone\(c\.phone\)/gu)].length, `${name}: телефон только в маске`);
    assert.equal([...text.matchAll(/\bc\.email\b/gu)].length, [...text.matchAll(/ai_agent_mask_email\(c\.email\)/gu)].length, `${name}: e-mail только в маске`);
  }
  assert.match(lead, /ai_agent_mask_phone\(c\.phone\)/u);
  assert.match(lead, /ai_agent_mask_email\(c\.email\)/u);
  // Телефон звонка в досье лида не выбирается вовсе: только число и время последнего звонка, без записи.
  assert.doesNotMatch(lead, /client_phone|recording_state/u);
  // Согласие 320: оба чата читаются только за проверкой, и в досье дела документы идут метаданными слота.
  assert.match(lead, /ai_agent_conversation_ai_allowed/u);
  assert.match(kase, /ai_agent_student_ai_allowed/u);
});

test("Postgres-прогон знает набор 382 по имени файла и требует маркер; набор не оставляет следов", () => {
  assert.match(RUNNER, /\*_platform_ai_agent_dossiers\.sql/u);
  assert.match(RUNNER, /a382_already_applied/u);
  assert.match(RUNNER, /platform_ai_agent_dossiers\.sql[\s\S]*A382_AI_AGENT_DOSSIERS_SUITE_PASSED/u);
  assert.match(SUITE, /A382_AI_AGENT_DOSSIERS_SUITE_PASSED/u);
  assert.match(SUITE, /ROLLBACK;\s*$/u);
  assert.ok(RUNNER.indexOf("*_platform_ai_agent_dossiers.sql") < RUNNER.indexOf('done < <(\n  cd "$repo_root"\n  find supabase/migrations'), "хук внутри цикла миграций");
  assert.doesNotMatch(SQL + SUITE, /sk-ant-|Bearer [A-Za-z0-9]|\+996\d{6,}|@gmail\.|@mail\./u);
});

test("наборы инструментов: досье лида у продаж и директора, досье дела у пяти кураторов и директора, ни у кого лишнего", () => {
  const withTool = (name) => AI_AGENT_KEYS.filter((key) => AI_AGENT_TOOL_GRANTS[key].includes(name)).sort();
  assert.deepEqual(withTool("get_lead_dossier"), ["director", "sales"]);
  assert.deepEqual(withTool("get_case_dossier"), ["curator-ae", "curator-cn", "curator-eu", "curator-my", "curator-tr", "director"]);
});

test("преамбула агентов: одна строка про досье, и инструменты называются по реестру", () => {
  assert.match(AI_AGENT_PREAMBLE, /Начинай с досье \(`get_lead_dossier` \/ `get_case_dossier`\); остальные инструменты чтения — только для догрузки\./u);
  assert.ok(AI_AGENT_PREAMBLE.length <= 8_000, `${AI_AGENT_PREAMBLE.length}`);
  const names = new Set(AI_AGENT_TOOLS.map((tool) => tool.name));
  assert.ok(names.has("get_lead_dossier") && names.has("get_case_dossier"));
});
