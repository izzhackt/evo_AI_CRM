/**
 * Китай 2026-11: чистые функции разбора рабочей таблицы EVO (колонки набора, срока, возраста, языка, названий
 * программ) и сборки карточек, программ, наборов и строк стоимости. Без чтения файлов и без сети: вход это
 * уже прочитанные строки таблицы, выход это содержимое карточки в формате `platform_private.valid_university_content`.
 * План: docs/catalog/china-2026-11-plan.md. Сборка из файлов: scripts/catalog/china-2026-11-build.mjs.
 */

/** Дата файла таблицы (изменён 16.01.2026): так помечены все наборы и суммы из неё. */
export const WORKSHEET_DATE = "2026-01-16";
export const WORKSHEET_NAME = "Рабочая таблица EVO, набор 2026";
export const ACADEMIC_YEAR = "2026/27";

const MONTH_RU = Object.freeze({ 1: "Январь", 2: "Февраль", 3: "Март", 4: "Апрель", 5: "Май", 6: "Июнь", 7: "Июль", 8: "Август", 9: "Сентябрь", 10: "Октябрь", 11: "Ноябрь", 12: "Декабрь" });
const MONTH_NUMBER = Object.freeze({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 });

export const collapse = (text) => String(text ?? "").replace(/[ 　\s]+/gu, " ").trim();

/** Латинский slug для id программы и ключа карточки (`^[a-z0-9][a-z0-9-]{0,63}$`). */
export function slugify(text, max = 56) {
  const base = collapse(text).normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase()
    .replace(/&/gu, " and ").replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (base.length <= max) return base || "program";
  const cut = base.slice(0, max);
  const at = cut.lastIndexOf("-");
  return (at > 20 ? cut.slice(0, at) : cut).replace(/-+$/gu, "");
}

/** «Chinese», «English/Chinese» → язык обучения для карточки и ISO-код для строки стоимости. */
export function normalizeLanguage(raw) {
  const text = collapse(raw).toLowerCase();
  const english = /english/u.test(text), chinese = /chinese/u.test(text);
  if (english && chinese) return { ru: "Английский или китайский", iso: "both" };
  if (english) return { ru: "Английский", iso: "en" };
  if (chinese) return { ru: "Китайский", iso: "zh" };
  return { ru: null, iso: null };
}

/** Колонка Intake: какие месяцы набора названы (март 3, сентябрь 9, октябрь 10) и есть ли «в течение года». */
export function parseIntake(raw) {
  const text = collapse(raw).toLowerCase();
  const months = [];
  if (/\bmar/u.test(text)) months.push(3);
  if (/\bsep/u.test(text)) months.push(9);
  if (/\boct/u.test(text)) months.push(10);
  return { months, rolling: /anytime|rolling|all year/u.test(text) };
}

const DEADLINE_WORDS = new Set(["jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june", "jul", "july",
  "aug", "august", "sep", "sept", "september", "oct", "october", "nov", "november", "dec", "december", "to", "and", "or", "until", "full",
  "the", "end", "of", "entry", "spring", "fall", "autumn", "intake", "anytime", "scholarship", "self", "supporting", "student", "students",
  "deadline", "application", "time", "registration", "is", "for", "from", "by", "before"]);

/**
 * Колонка Deadline: очищенный текст срока или null. Текст берётся только если он состоит из слов срока (месяцы, числа,
 * «deadline», «spring entry», «until full»); любая другая фраза (процесс подачи, виза, стипендия, оплата, JW202) отбрасывается
 * целиком. Даты из текста НЕ разбираются: год в нём часто не указан, а окна «осень 2026 / весна» бывают и в будущем.
 */
export function cleanDeadlineText(raw) {
  // Chinese remarks after the English deadline are cut off together with the trailing punctuation.
  const text = collapse(String(raw ?? "").replace(/[\uff0c\u3001]/gu, ",").replace(/[\uff1a]/gu, ":").split(/[\u3400-\u9fff]/u)[0]).replace(/[\s,;:-]+$/u, "");
  if (text === "") return null;
  const words = text.replace(/(\d)\s*(?:st|nd|rd|th)\b/giu, "$1").match(/[A-Za-z]+/gu) ?? [];
  if (words.length === 0 || !words.every((word) => DEADLINE_WORDS.has(word.toLowerCase()))) return null;
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

/**
 * Следы автозаполнения Excel: число в конце текста растёт ровно на 1 подряд на трёх и более строках вуза
 * («Age: 18-28», «18-29», «18-30»; «June 31», «June 32»). Такие значения недостоверны. Вход: строки вуза по возрастанию
 * номера, у каждой текст ячейки; результат: множество номеров строк внутри таких серий.
 */
export function autoFillRows(entries) {
  const key = (text) => { const found = String(text ?? "").match(/\d+/gu)?.map(Number) ?? []; return found.length === 0 ? null : { last: found.at(-1), head: found.slice(0, -1).join(",") }; };
  const flagged = new Set();
  let run = [];
  const flush = () => { if (run.length >= 3) for (const row of run) flagged.add(row); run = []; };
  let previous = null;
  for (const entry of entries) {
    const current = key(entry.text);
    if (current !== null && previous !== null && previous.key.last + 1 === current.last && previous.key.head === current.head) run.push(entry.row);
    else { flush(); run = current === null ? [] : [entry.row]; }
    previous = current === null ? null : { key: current };
  }
  flush();
  return flagged;
}

/** Колонка Requirements: только простой возрастной предел; всё остальное (квоты стран, служебное) не берётся. */
export function parseAge(raw) {
  const text = collapse(String(raw ?? "").replace(/[：]/gu, ":").replace(/[–—~]/gu, "-"));
  const ranges = new Set(), limits = new Set();
  for (const match of text.matchAll(/\b(\d{2})\s*-\s*(\d{2})\b/gu)) ranges.add(`${match[1]}-${match[2]}`);
  for (const match of text.matchAll(/\bunder\s*(\d{2})\b/giu)) limits.add(match[1]);
  for (const match of text.matchAll(/\b(\d{2})\s*(?:years?(?:\s*old)?\s*)?(?:or\s+)?(?:below|under|younger)\b/giu)) limits.add(match[1]);
  if (ranges.size + limits.size !== 1) return null;
  if (ranges.size === 1) {
    const [low, high] = [...ranges][0].split("-").map(Number);
    return low >= 14 && high <= 60 && low < high ? `${low}-${high} лет` : null;
  }
  const limit = Number([...limits][0]);
  return limit >= 18 && limit <= 60 ? `до ${limit} лет` : null;
}

/** Явная длительность из китайского префикса названия («5年»): единственный случай, когда `duration` не пустой. */
export function parseDurationYears(rawMajor) {
  const match = /(\d)\s*年/u.exec(String(rawMajor ?? ""));
  if (!match) return null;
  const years = Number(match[1]);
  return years >= 2 && years <= 8 ? years : null;
}

export const yearsRu = (years) => `${years} ${years === 1 ? "год" : years < 5 ? "года" : "лет"}`;

/**
 * Один набор на каждый месяц колонки Intake. Год и срок подачи как даты не записываются (статус «unknown», дат нет):
 * таблица описывает набор 2026, а даты ближайшего набора подтверждает менеджер у университета. Срок из таблицы
 * остаётся словами в заметке.
 */
export function buildIntakes({ intakeRaw, deadlineRaw, sourceUrl }) {
  const { months, rolling } = parseIntake(intakeRaw);
  const deadline = cleanDeadlineText(deadlineRaw);
  const base = "Месяц набора по таблице EVO (набор 2026, файл от 16.01.2026). Даты ближайшего набора и срок подачи подтверждает менеджер у университета.";
  const note = (extra) => (extra ? `${base} Срок по таблице: ${extra}.` : base).slice(0, 1000);
  const intakes = months.map((month) => ({
    label: `${MONTH_RU[month]} (по таблице EVO)`,
    startDate: null, startMonth: null, applicationDeadline: null, deadlineTime: null, timezone: null,
    status: "unknown", note: note(deadline), sourceUrl, verifiedOn: WORKSHEET_DATE,
  }));
  if (months.length === 0 && rolling) {
    intakes.push({
      label: "В течение года (по таблице EVO)",
      startDate: null, startMonth: null, applicationDeadline: null, deadlineTime: null, timezone: null,
      status: "unknown", note: note(deadline), sourceUrl, verifiedOn: WORKSHEET_DATE,
    });
  }
  return intakes;
}

const SCHOLARSHIP_POINTER = "В таблице EVO для программы указаны стипендиальные условия; тип, размер и наличие мест подтверждает менеджер.";

/** Текст программы: только факты таблицы и нейтральная строка про стипендии, без обещаний. */
export function buildSummary({ languageRu, ageRu, scholarship }) {
  const parts = [];
  if (languageRu) parts.push(`Язык обучения: ${languageRu.toLowerCase()}.`);
  if (ageRu) parts.push(`Возраст по таблице EVO: ${ageRu}.`);
  if (scholarship) parts.push(SCHOLARSHIP_POINTER);
  parts.push("Программа взята из рабочей таблицы EVO (набор 2026).");
  return parts.join(" ");
}

/** Буквы названия без регистра, пробелов и знаков: основа сверки «перед и после чистки». */
export const lettersOnly = (text) => String(text ?? "").toLowerCase().replace(/[^a-z]/gu, "");

/** Расстояние Левенштейна (малые строки): страж, что чистка названий не придумывает слова. */
export function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const held = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = held;
    }
  }
  return row[b.length];
}

/** Результат чистки названия допустим, если буквы почти те же, что в исходнике (не более 3 исправлений). */
export function cleanedTitleIsFaithful(raw, titles, tolerance = 3) {
  return editDistance(lettersOnly(raw), titles.map(lettersOnly).join("")) <= tolerance;
}

/** Уникальный id программы внутри карточки: slug, затем с языком, затем с номером. */
export function uniqueProgramId(title, languageIso, taken) {
  const base = slugify(title, 52);
  const candidates = [base, `${base}-${languageIso ?? "x"}`];
  for (const candidate of candidates) if (!taken.has(candidate)) return candidate;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`no free program id for ${title}`);
}

export const CARD_NOTES = [
  "Перечень программ бакалавриата, языки обучения, месяцы набора и ориентировочные суммы взяты из рабочей таблицы EVO",
  "(файл от 16.01.2026, набор 2026). Название, город и сайт вуза сверены с официальными источниками; программы по",
  "отдельности с сайтом вуза не сверялись, поэтому у программ указана общая страница вуза. Даты ближайшего набора,",
  "срок подачи и окончательную сумму подтверждает менеджер EVO у университета.",
  "Наличие программы в каталоге не означает гарантии приёма, стипендии, визы или признания диплома.",
].join(" ");

export const MERGE_NOTE = "Часть программ бакалавриата добавлена из рабочей таблицы EVO (набор 2026, файл от 16.01.2026); у них в наборах стоит пометка «по таблице EVO».";

/** Фраза в обзоре карточки: сколько программ и на каких языках. */
export function programmesSentence(programs) {
  const count = (pick) => programs.filter(pick).length;
  const english = count((p) => p.language === "Английский"), chinese = count((p) => p.language === "Китайский");
  const both = count((p) => p.language === "Английский или китайский");
  const bits = [];
  if (english > 0) bits.push(`${english} на английском`);
  if (chinese > 0) bits.push(`${chinese} на китайском`);
  if (both > 0) bits.push(`${both} на английском или китайском`);
  const total = programs.length;
  return `В каталоге ${total} ${total % 10 === 1 && total % 100 !== 11 ? "программа" : total % 10 >= 2 && total % 10 <= 4 && (total % 100 < 10 || total % 100 >= 20) ? "программы" : "программ"} бакалавриата${bits.length > 0 ? `: ${bits.join(", ")}` : ""}.`;
}

/** Язык программы карточки как класс: en, zh, both или null (не указан или неясен). */
export function languageClass(language) {
  const text = String(language ?? "").toLowerCase();
  const english = text.includes("англ"), chinese = text.includes("китай");
  if (english && chinese) return "both";
  if (english) return "en";
  if (chinese) return "zh";
  return null;
}

/** Та же программа уже есть, если название совпадает и языки не различаются определённо (английский против китайского). */
const sameProgramme = (existing, candidate) => {
  if (lettersOnly(existing.title) !== lettersOnly(candidate.title)) return false;
  const a = languageClass(existing.language), b = languageClass(candidate.language);
  return a === null || b === null || a === "both" || b === "both" || a === b;
};

/** Слияние в уже существующую карточку: старые поля и программы не меняются, добавляются только новые программы. */
export function mergeIntoExisting(existing, additions) {
  const taken = new Set(existing.programs.map((p) => p.id));
  const known = [...existing.programs];
  const added = [], idMap = new Map(), skipped = [];
  for (const program of additions) {
    if (known.some((entry) => sameProgramme(entry, program))) { skipped.push(program.id); continue; }
    const id = taken.has(program.id) ? uniqueProgramId(program.title, program.languageIso ?? null, taken) : program.id;
    taken.add(id);
    const { languageIso, ...rest } = program;
    void languageIso;
    const next = { ...rest, id };
    known.push(next);
    added.push(next);
    idMap.set(program.id, id);
  }
  const notes = existing.notes.includes("рабочей таблицы EVO") ? existing.notes : `${existing.notes} ${MERGE_NOTE}`.trim();
  return { content: { ...existing, notes: notes.slice(0, 1500), programs: [...existing.programs, ...added] }, added: added.length, idMap, skipped };
}

// ---------------------------------------------------------------------------------------------------------------
// Названия специальностей: механическая предочистка (та же, что при подготовке списка для вычитки) и разбор ответа.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Предочистка названия из таблицы: китайские фрагменты, номера и значки в начале, значок списка «l», склеенное
 * `...andTrade`. Результат это ключ словаря вычитки (major-title-fixes), поэтому функция детерминирована.
 */
export function basicMajorClean(raw) {
  let text = String(raw ?? "").replace(/ /gu, " ");
  if (/[一-鿿]/u.test(text)) text = text.replace(/[（(]?[一-鿿]+[）)]?[0-9年]*/gu, "");
  if (/^\s*[◆•●*-]?\s*\d+\s*[.、)]/u.test(text) || text.trimStart().startsWith("◆")) {
    text = text.replace(/^\s*[◆•●*-]?\s*\d*\s*[.、)]?\s*(?=[A-Za-z])/u, "");
  }
  text = text.replace(/^l(?=[A-Z])/u, "").replace(/([a-z])and([A-Z])/gu, "$1 and $2");
  return text.replace(/\s+/gu, " ").trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Стоимость: проверка разбора текстов платы двумя независимыми проходами и сборка строк импорта (формат planImport).
// ---------------------------------------------------------------------------------------------------------------

const COST_KINDS = ["tuition", "accommodation", "application_fee", "insurance", "other"];
const COST_PERIODS = ["year", "semester", "month", "week", "day", "once", "program", "unknown"];
const COST_BASES = ["standard", "after_scholarship", "unclear"];
const KIND_EVIDENCE = Object.freeze({
  tuition: /tuit|tuiton/iu, accommodation: /accommod|dorm|room|residen|hostel|apartment|housing/iu,
  application_fee: /applic|regist/iu, insurance: /insur/iu,
});
const numbersIn = (text) => [...String(text).matchAll(/\d[\d,]*(?:\.\d+)?/gu)].map((match) => Number(match[0].replace(/,/gu, "")));

/** Один разобранный элемент допустим, только если он целиком подтверждён исходным текстом. */
export function validateCostItem(sourceText, item) {
  const text = collapse(sourceText);
  const problems = [];
  if (item === null || typeof item !== "object") return ["not an object"];
  if (!COST_KINDS.includes(item.kind)) problems.push("kind");
  if (!COST_BASES.includes(item.basis)) problems.push("basis");
  if (!COST_PERIODS.includes(item.period)) problems.push("period");
  if (typeof item.evidence !== "string" || item.evidence === "" || !text.includes(collapse(item.evidence))) problems.push("evidence_not_in_text");
  const min = item.min, max = item.max ?? null;
  if (typeof min !== "number" || !Number.isFinite(min) || min < 0) problems.push("min");
  if (max !== null && (typeof max !== "number" || !Number.isFinite(max) || max <= min)) problems.push("max");
  if (problems.length === 0) {
    const inEvidence = new Set(numbersIn(item.evidence));
    if (!inEvidence.has(min) || (max !== null && !inEvidence.has(max))) problems.push("amount_not_in_evidence");
    const label = KIND_EVIDENCE[item.kind];
    // The kind must be named by the evidence itself or by the words right before it, up to the previous amount.
    const at = text.indexOf(collapse(item.evidence));
    let start = at;
    while (start > 0 && at - start < 48 && !/\d/u.test(text[start - 1])) start -= 1;
    const window = text.slice(start, at + collapse(item.evidence).length);
    if (label && !label.test(window)) problems.push("kind_not_named_near_evidence");
  }
  return problems;
}

export const costSignature = (item) => [item.kind, item.basis, item.scope ?? "all", item.min, item.max ?? "", item.period, item.room ?? ""].join("|");

/** Принимаются только элементы, прошедшие проверку по тексту и совпавшие в обоих независимых разборах. */
export function acceptCostItems(sourceText, itemsA, itemsB) {
  const valid = (items) => (Array.isArray(items) ? items : []).map((item) => ({ item, problems: validateCostItem(sourceText, item) }));
  const a = valid(itemsA), b = valid(itemsB);
  const bySig = new Map(b.filter((entry) => entry.problems.length === 0).map((entry) => [costSignature(entry.item), entry.item]));
  const accepted = [], rejected = [];
  const seen = new Set();
  for (const entry of a) {
    const signature = entry.problems.length === 0 ? costSignature(entry.item) : null;
    if (signature !== null && bySig.has(signature)) {
      if (!seen.has(signature)) { seen.add(signature); accepted.push(entry.item); }
    } else rejected.push({ pass: "A", item: entry.item, why: entry.problems.length > 0 ? entry.problems : ["not confirmed by the second pass"] });
  }
  for (const entry of b) {
    const signature = entry.problems.length === 0 ? costSignature(entry.item) : null;
    if (signature === null || !seen.has(signature)) rejected.push({ pass: "B", item: entry.item, why: entry.problems.length > 0 ? entry.problems : ["not confirmed by the first pass"] });
  }
  return { accepted, rejected };
}

const LANGUAGE_BY_SCOPE = Object.freeze({ english_taught: "en", chinese_taught: "zh" });
const amountText = (value) => String(value);

/**
 * Строки стоимости одного вуза (уровень bachelor, источник evo_document). Вход: принятые элементы по каждой группе
 * текстов платы и языки программ вуза. Неоднозначное (разные периоды, стипендийная сумма вместо платы) не вносится.
 */
export function buildCostRows({ cardKey, institutionName, programmeLanguages, groups, existingPublished = [] }) {
  const hasLanguage = (iso) => programmeLanguages.has(iso) || programmeLanguages.has("both");
  const bucket = new Map();
  const dropped = [];
  for (const group of groups) {
    for (const item of group.accepted) {
      if (item.min === 0 || item.kind === "other") continue;
      if (item.kind === "tuition" && item.basis !== "standard") { dropped.push({ feeId: group.feeId, why: "tuition is not the standard fee", item }); continue; }
      if (item.kind === "tuition" && item.scope === "language_course") continue;
      let period = item.period;
      if (item.kind === "application_fee" && period === "unknown") period = "once";
      // An application fee is paid once; a periodic «fee» in the text may be an annual registration fee, which is a different cost.
      if (item.kind === "application_fee" && period !== "once") { dropped.push({ feeId: group.feeId, why: "application fee with a periodic unit", item }); continue; }
      if (period === "unknown") { dropped.push({ feeId: group.feeId, why: "period is not stated", item }); continue; }
      if (item.kind === "insurance" && !["year", "program"].includes(period)) { dropped.push({ feeId: group.feeId, why: "insurance period", item }); continue; }
      const language = item.kind === "tuition" ? (LANGUAGE_BY_SCOPE[item.scope] ?? null) : null;
      if (language !== null && !hasLanguage(language)) continue;
      const key = `${item.kind}|${language ?? ""}`;
      const entry = bucket.get(key) ?? { kind: item.kind, language, periods: new Set(), mins: [], maxes: [] };
      entry.periods.add(period);
      entry.mins.push(item.min);
      entry.maxes.push(item.max ?? item.min);
      bucket.set(key, entry);
    }
  }
  // Explicit per-language tuition replaces the general tuition line.
  const explicit = [...bucket.values()].some((entry) => entry.kind === "tuition" && entry.language !== null);
  const rows = [];
  for (const entry of bucket.values()) {
    if (entry.kind === "tuition" && explicit && entry.language === null) continue;
    if (entry.periods.size !== 1) { dropped.push({ why: `conflicting periods for ${entry.kind}`, periods: [...entry.periods] }); continue; }
    const covered = existingPublished.some((row) => row.kind === entry.kind && (entry.kind !== "tuition" || row.level === "bachelor"));
    if (covered) { dropped.push({ why: `a published ${entry.kind} row already exists`, kind: entry.kind }); continue; }
    const min = Math.min(...entry.mins), max = Math.max(...entry.maxes);
    rows.push({
      importKey: `cn26:${cardKey}:${entry.kind}:${entry.language ?? "all"}`,
      country: "CN", institutionName,
      studyLevel: entry.kind === "tuition" ? "bachelor" : null,
      teachingLanguage: entry.language,
      costKind: entry.kind, period: [...entry.periods][0],
      amountMin: amountText(min), ...(max > min ? { amountMax: amountText(max) } : {}),
      currency: "CNY", academicYear: ACADEMIC_YEAR,
      sourceKind: "evo_document", sourceName: WORKSHEET_NAME, verifiedOn: WORKSHEET_DATE, publish: true,
    });
  }
  return { rows, dropped };
}
