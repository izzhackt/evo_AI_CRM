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
  if (!deadlineIsPlausible(text)) return null;
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

const MONTH_INDEX = Object.freeze({ jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 });
const MONTH_DAYS = Object.freeze({ 1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 });

/** Срок из таблицы с невозможной датой («June 31») или перевёрнутым диапазоном («November 2026 to Feb 15, 2026») не показывается. */
export function deadlineIsPlausible(text) {
  const names = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
  const flat = String(text).replace(/(\d)\s*(?:st|nd|rd|th)\b/giu, "$1");
  for (const match of flat.matchAll(new RegExp(`\\b(${names})[a-z]*\\.?[\\s,]*(\\d{1,2})(?!\\d)`, "giu"))) {
    if (Number(match[2]) < 1 || Number(match[2]) > MONTH_DAYS[MONTH_INDEX[match[1].toLowerCase()]]) return false;
  }
  for (const match of flat.matchAll(new RegExp(`(?<!\\d)(\\d{1,2})[\\s,]*(${names})[a-z]*`, "giu"))) {
    if (Number(match[1]) < 1 || Number(match[1]) > MONTH_DAYS[MONTH_INDEX[match[2].toLowerCase()]]) return false;
  }
  const range = new RegExp(`(${names})[a-z]*\\.?\\s*\\d{0,2}[\\s,]*(20\\d\\d)?\\s*(?:to|-)\\s*(${names})[a-z]*\\.?\\s*\\d{0,2}[\\s,]*(20\\d\\d)?`, "giu");
  for (const match of flat.matchAll(range)) {
    const [, first, firstYear, last, lastYear] = match;
    if (firstYear && lastYear && (Number(firstYear) > Number(lastYear)
      || (firstYear === lastYear && MONTH_INDEX[first.toLowerCase()] > MONTH_INDEX[last.toLowerCase()]))) return false;
  }
  return true;
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

/**
 * Следы автозаполнения Excel в тексте платы: в соседних строках одного вуза один и тот же текст, а ПОСЛЕДНЕЕ число
 * растёт ровно на 1 («Dorms: CNY 1,200», «1,201», «1,202», «1,203» или «6,000» … «6,017» за одноместную комнату).
 * Исходное значение у первой строки серии (Excel растягивает то, что ввёл человек), остальные тексты производные:
 * их строки переходят к группе первой строки, иначе из одной суммы получился бы выдуманный диапазон.
 * Серия это три и более соседних СТРОКИ Excel (группа с одинаковым текстом может стоять в строках далеко друг от
 * друга, поэтому работаем по строкам); всё остальное в тексте обязано совпадать. Одна строка посреди серии, где
 * начальное значение набрано заново, серию не прерывает, если следующая строка продолжает счёт.
 */
export function collapseFeeAutoFill(groups) {
  const tokenPattern = /\d+(?:,\d{3})*(?:\.\d+)?/gu;
  const shape = (text) => {
    const source = collapse(String(text ?? ""));
    const values = [...source.matchAll(tokenPattern)].map((match) => Number(match[0].replace(/,/gu, "")));
    return { skeleton: source.replace(tokenPattern, "#"), values };
  };
  const target = new Map();
  const collapsed = [];
  const byUid = new Map();
  for (const group of groups) {
    const parsed = shape(group.text);
    for (const row of group.rows) byUid.set(group.uid, [...(byUid.get(group.uid) ?? []), { row, group, parsed }]);
  }
  for (const [uid, list] of byUid) {
    list.sort((a, b) => a.row - b.row);
    let run = [];
    const flush = () => {
      if (run.length >= 3) {
        for (const entry of run) target.set(entry.row, run[0].group.feeId);
        collapsed.push({ uid, feeIds: [...new Set(run.map((entry) => entry.group.feeId))], rows: run.map((entry) => entry.row), firstValue: run[0].parsed.values.at(-1) });
      }
      run = [];
    };
    // The text around the number and every number but the last must match the first row of the run.
    const sameShape = (entry, head) => entry.parsed.values.length > 0 && entry.parsed.skeleton === head.parsed.skeleton
      && entry.parsed.values.length === head.parsed.values.length
      && entry.parsed.values.slice(0, -1).every((value, index) => value === head.parsed.values[index]);
    let next = 0;
    let holeUsed = false;
    for (let index = 0; index < list.length; index += 1) {
      const entry = list[index];
      const head = run[0];
      if (head !== undefined && entry.row === run.at(-1).row + 1 && sameShape(entry, head)) {
        const value = entry.parsed.values.at(-1);
        if (value === next) { run.push(entry); next += 1; continue; }
        // One row, once per run and only after three rows of a real fill, where the start value was typed again by hand:
        // when the row after it carries the number the fill would have reached, the fill goes on through it (a repeated
        // start value is not a new price).
        const after = list[index + 1];
        if (!holeUsed && run.length >= 3 && value === head.parsed.values.at(-1) && after !== undefined && after.row === entry.row + 1
          && sameShape(after, head) && after.parsed.values.at(-1) === next + 1) { run.push(entry); next += 1; holeUsed = true; continue; }
      }
      flush();
      run = entry.parsed.values.length > 0 ? [entry] : [];
      next = (entry.parsed.values.at(-1) ?? 0) + 1;
      holeUsed = false;
    }
    flush();
  }
  const rowsOf = new Map(groups.map((group) => [group.feeId, []]));
  for (const group of groups) for (const row of group.rows) rowsOf.get(target.get(row) ?? group.feeId).push(row);
  const kept = groups
    .filter((group) => rowsOf.get(group.feeId).length > 0)
    .map((group) => {
      const rows = rowsOf.get(group.feeId).sort((a, b) => a - b);
      const copy = { ...group, rows };
      if ("rowCount" in group) copy.rowCount = rows.length;
      return copy;
    });
  return { groups: kept, collapsed };
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
  // Rows of one programme that repeat in the worksheet (March and September on separate rows) are passed as lists and united.
  const monthSet = new Set();
  let rolling = false;
  for (const raw of Array.isArray(intakeRaw) ? intakeRaw : [intakeRaw]) {
    const parsed = parseIntake(raw);
    for (const month of parsed.months) monthSet.add(month);
    rolling ||= parsed.rolling;
  }
  const months = [...monthSet].sort((a, b) => a - b);
  const texts = [...new Set((Array.isArray(deadlineRaw) ? deadlineRaw : [deadlineRaw]).map(cleanDeadlineText).filter((text) => text !== null))];
  const deadline = texts.length === 0 ? null : texts.join("; ").slice(0, 400);
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
  "(файл от 16.01.2026, набор 2026). Название, город и сайт вуза сверены по официальным страницам вуза и открытым",
  "справочникам (Wikidata, Wikipedia); программы по отдельности с сайтом вуза не сверялись, поэтому у программ указана",
  "общая страница вуза. Даты ближайшего набора, срок подачи и окончательную сумму подтверждает менеджер EVO у университета.",
  "Наличие программы в каталоге не означает гарантии приёма, стипендии, визы или признания диплома.",
].join(" ");

export const MERGE_NOTE = "Часть программ бакалавриата добавлена из рабочей таблицы EVO (набор 2026, файл от 16.01.2026); по отдельности они с сайтом вуза не сверялись, ссылка у них общая страница карточки, в наборах стоит пометка «по таблице EVO».";

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
  // The note grows by exactly MERGE_NOTE (the SQL guard accepts nothing else); a note that would pass 1 500 characters stays as it is.
  const appended = `${existing.notes} ${MERGE_NOTE}`;
  const notes = existing.notes.includes("рабочей таблицы EVO") || appended.length > 1500 ? existing.notes : appended;
  return { content: { ...existing, notes, programs: [...existing.programs, ...added] }, added: added.length, idMap, skipped };
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

/**
 * Название вида суммы стоит в самом фрагменте или перед ним: последнее слово-метка этого вида до фрагмента, и между ней
 * и фрагментом нет метки другого вида («Tuition: Arts 10000, Science 16000»: метка «Tuition» действует на оба числа).
 */
function kindLabelApplies(text, evidenceText, kind) {
  const label = KIND_EVIDENCE[kind];
  if (!label) return true;
  const evidence = collapse(evidenceText);
  if (label.test(evidence)) return true;
  // A fragment that names another kind of cost is that other cost, whatever stands before it.
  if (Object.entries(KIND_EVIDENCE).some(([other, pattern]) => other !== kind && pattern.test(evidence))) return false;
  const before = text.slice(0, text.indexOf(evidence));
  const every = new RegExp(label.source, "giu");
  let last = null, found;
  while ((found = every.exec(before)) !== null) last = found;
  if (last === null) return false;
  const between = before.slice(last.index + last[0].length);
  return !Object.entries(KIND_EVIDENCE).some(([other, pattern]) => other !== kind && pattern.test(between));
}

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
    if (!kindLabelApplies(text, item.evidence, item.kind)) problems.push("kind_not_named_near_evidence");
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
  // Another standard tuition amount that only one pass found (or that failed a check) means the text names several prices:
  // a single amount would be wrong for part of the programmes, so this university gets no tuition row.
  const tuitionAmbiguous = groups.some((group) => (group.rejected ?? []).some((entry) => entry.item?.kind === "tuition"
    && entry.item.basis === "standard" && entry.item.scope !== "language_course"));
  if (tuitionAmbiguous) dropped.push({ why: "tuition: the text names amounts that were not confirmed by both passes" });
  for (const group of groups) {
    for (const item of group.accepted) {
      if (item.kind === "tuition" && tuitionAmbiguous) continue;
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

/** Статусные метки («211», «985», «Double First-Class») в обзорах не нужны: правила каталога не допускают рейтингов и званий. */
const STATUS_LABEL = /Double\s*First[-\s]?Class|(?<!\d)(?:211|985)(?!\d)|Двойн\p{L}*\s+перв\p{L}*/iu;
export function scrubOverview(text) {
  return collapse(text).split(/(?<=[.!?])\s+/u).filter((sentence) => !STATUS_LABEL.test(sentence)).join(" ");
}
