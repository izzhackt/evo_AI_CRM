/**
 * Набор на карточке «Воронки поступления». Клиентский модуль без сервера:
 * слова сезона — только из `wording.ts`, ключ анкеты на экран не попадает.
 */
import { intakeSeason } from "./v3/wording.ts";

/** Сырьё набора с доски (миграция 362). Любое поле можно не прислать. */
export type AdmissionsPipelineIntakeSources = Readonly<{
  applicationSeason?: unknown;
  applicationYear?: unknown;
  wishesSeason?: unknown;
  wishesYear?: unknown;
  intakeText?: unknown;
}>;

type Season = "spring" | "summer" | "autumn" | "winter" | "undecided";

const FILLER = new Set(["сезон", "набор", "год", "года", "году", "в", "на", "или"]);
/** Оговорки менеджера («скорее осень»): на метке остаётся сам сезон. */
const HEDGE = new Set(["скорее", "скорей", "наверное", "возможно", "вероятно", "примерно", "probably", "maybe"]);
/** «След год», «в следующем году», «next year»: дата записи неизвестна, поэтому год не вычисляется. */
const NEXT = new Set(["след", "следующий", "следующем", "следующего", "следующую", "next"]);
const YEAR_WORD = new Set(["год", "году", "года", "year"]);
const NEXT_YEAR = "Следующий год";
const NEXT_YEAR_AFTER_SEASON = "следующего года";
const MONTH: Readonly<Record<string, Exclude<Season, "undecided">>> = {
  март: "spring", марта: "spring", марте: "spring", апрель: "spring", апреля: "spring", апреле: "spring",
  май: "spring", мая: "spring", мае: "spring", march: "spring", april: "spring", may: "spring",
  июнь: "summer", июня: "summer", июне: "summer", июль: "summer", июля: "summer", июле: "summer",
  август: "summer", августа: "summer", августе: "summer", june: "summer", july: "summer", august: "summer",
  сентябрь: "autumn", сентября: "autumn", сентябре: "autumn", сент: "autumn", октябрь: "autumn", октября: "autumn",
  октябре: "autumn", ноябрь: "autumn", ноября: "autumn", ноябре: "autumn",
  september: "autumn", sept: "autumn", october: "autumn", november: "autumn",
  декабрь: "winter", декабря: "winter", декабре: "winter", январь: "winter", января: "winter", январе: "winter",
  февраль: "winter", февраля: "winter", феврале: "winter",
  december: "winter", january: "winter", february: "winter",
};
const SEASON_WORD: Readonly<Record<string, Season>> = {
  весна: "spring", весной: "spring", весну: "spring", spring: "spring",
  лето: "summer", летом: "summer", summer: "summer",
  осень: "autumn", осенью: "autumn", autumn: "autumn", fall: "autumn",
  зима: "winter", зимой: "winter", зиму: "winter", winter: "winter",
  undecided: "undecided",
};
const NUMERIC_MONTH: readonly Exclude<Season, "undecided">[] = [
  "winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter",
];

/** «Пока не определился» на карточке ничего не сообщает: остаётся только год (решение владельца 17.11.2026). */
function seasonWord(key: string | null): string | null {
  return key === null || key === "undecided" ? null : intakeSeason(key);
}

function yearOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2100) return value;
  if (typeof value === "string" && /^(19|20|21)\d{2}$/u.test(value.trim())) return Number(value.trim());
  return null;
}

function textOf(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/gu, " ").trim();
  if (text === "" || text.length > max || /[\u0000-\u001f\u007f]/u.test(text)) return null;
  return text;
}

function join(word: string | null, year: number | null): string | null {
  if (word && year) return `${word} ${year}`;
  return word ?? (year === null ? null : String(year));
}

type Recognized = { season: Season | null; second: Season | null; year: number | null; nextYear: boolean };

function seasonOf(token: string): Exclude<Season, "undecided"> | null {
  const season = SEASON_WORD[token] ?? MONTH[token] ?? null;
  return season === "undecided" ? null : season;
}

/**
 * Месяц или слово сезона (одно или два: «весна/осень»), год — четыре цифры,
 * две цифры рядом с сезоном («26 осень») или «следующий год», если в строке
 * больше ничего нет. Иначе null: вызывающий оставляет текст как есть.
 */
function recognize(text: string): Recognized | null {
  let working = text;
  let season: Season | null = null;
  let second: Season | null = null;
  if (/не\s+определ|пока\s+не\s+(?:определ|решил)/u.test(text.toLocaleLowerCase("ru-RU"))) {
    season = "undecided";
    working = working.replace(/сезон\s+не\s+определ\p{L}*|пока\s+не\s+определ\p{L}*|пока\s+не\s+решил\p{L}*/giu, " ");
  }
  const yearMatch = working.match(/(?:19|20|21)\d{2}/u);
  let year = yearMatch ? Number(yearMatch[0]) : null;
  const tokens = working.replace(/(?:19|20|21)\d{2}/gu, " ").toLocaleLowerCase("ru-RU").split(/[^0-9a-zа-яё]+/iu).filter(Boolean);
  const nextYear = tokens.some((token) => NEXT.has(token)) && tokens.some((token) => YEAR_WORD.has(token));
  const leftover: string[] = [];
  for (const token of tokens) {
    const word = seasonOf(token);
    if (word && !season) season = word;
    else if (word && season !== "undecided" && !second && word !== season) second = word;
    else if (word && word === season) continue;
    else if (FILLER.has(token) || HEDGE.has(token) || (nextYear && (NEXT.has(token) || YEAR_WORD.has(token)))) continue;
    else leftover.push(token);
  }
  if (!season && leftover.length === 1 && /^(?:0?[1-9]|1[0-2])$/u.test(leftover[0] ?? "")) {
    season = NUMERIC_MONTH[Number(leftover[0]) - 1] ?? null;
    leftover.length = 0;
  }
  if (season && season !== "undecided" && year === null && !nextYear && leftover.length === 1 && /^[23]\d$/u.test(leftover[0] ?? "")) {
    year = 2000 + Number(leftover[0]);
    leftover.length = 0;
  }
  if (leftover.length > 0 || (!season && year === null && !nextYear)) return null;
  if (nextYear && year !== null) return null;
  return { season, second, year, nextYear };
}

function fromRecognized(recognized: Recognized, yearOverride: number | null): string | null {
  const first = seasonWord(recognized.season);
  const second = seasonWord(recognized.second);
  const word = first && second ? `${first}/${second.toLocaleLowerCase("ru-RU")}` : first;
  const year = yearOverride ?? recognized.year;
  if (year === null && recognized.nextYear) return word ? `${word} ${NEXT_YEAR_AFTER_SEASON}` : NEXT_YEAR;
  return join(word, year);
}

/**
 * Лучший набор, в этом порядке: сезон и год анкеты студента, пожелания лида
 * (`wishes_intake_season` / `wishes_intake_year`), свободный текст дела
 * (прямое добавление вроде «сентябрь 2027»). Сезон и месяц становятся словом
 * («Осень 2027», «Весна/осень», «26 осень» → «Осень 2026», «след год» →
 * «Следующий год»), «не определился» — только год или ничего. Текст, который
 * так не прочитать, остаётся как есть. Пусто — null.
 */
export function admissionsPipelineIntakeLabel(sources: AdmissionsPipelineIntakeSources): string | null {
  if (sources.applicationSeason != null || sources.applicationYear != null) {
    const key = typeof sources.applicationSeason === "string" ? sources.applicationSeason.trim() : null;
    const year = yearOf(sources.applicationYear);
    if (key === "undecided" || intakeSeason(key) || year) return join(seasonWord(key), year);
  }
  const wishesSeason = textOf(sources.wishesSeason, 100);
  const wishesYear = yearOf(sources.wishesYear);
  if (wishesSeason || wishesYear !== null) {
    const recognized = wishesSeason ? recognize(wishesSeason) : null;
    if (recognized) return fromRecognized(recognized, wishesYear);
    if (wishesSeason && wishesYear !== null && !wishesSeason.includes(String(wishesYear))) {
      return textOf(`${wishesSeason} ${wishesYear}`, 120);
    }
    return wishesSeason ?? (wishesYear === null ? null : String(wishesYear));
  }
  const raw = textOf(sources.intakeText);
  if (!raw) return null;
  const recognized = recognize(raw);
  return recognized ? fromRecognized(recognized, null) : raw;
}
