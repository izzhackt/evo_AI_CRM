/** Public, source-reviewed catalogue DTO. Never serialize import registry rows. */
export const UNIVERSITY_LEVELS = ["foundation", "diploma", "bachelor", "master", "doctorate"] as const;
export type UniversityLevel = (typeof UNIVERSITY_LEVELS)[number];
export const UNIVERSITY_LEVEL_LABELS: Record<UniversityLevel, string> = { foundation: "Подготовительная программа", diploma: "Диплом", bachelor: "Бакалавриат", master: "Магистратура", doctorate: "Докторантура" };
/** ISO regions, including future manual publications; Europe is not a country. */
export const UNIVERSITY_COUNTRIES = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(" ");
export const UNIVERSITY_PHOTOS = {
  sunway: { path: "/universities/sunway.jpg", author: "Cmglee", title: "Cmglee Sunway University new building", caption: "Корпус кампуса Sunway University", sourceUrl: "https://commons.wikimedia.org/wiki/File:Cmglee_Sunway_University_new_building.jpg", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" },
  mmu: { path: "/universities/mmu.jpg", author: "Dunhill1410", title: "CYBER.jpg", caption: "Кампус MMU в Cyberjaya, 2009", sourceUrl: "https://commons.wikimedia.org/wiki/File:CYBER.jpg", license: "Public domain (PD-self)", licenseUrl: "https://commons.wikimedia.org/wiki/File:CYBER.jpg" },
  xjtlu: { path: "/universities/xjtlu.jpg", author: "Goyah", title: "XJTLU Admin Lib.JPG", caption: "Административно-информационный корпус XJTLU, 2013", sourceUrl: "https://commons.wikimedia.org/wiki/File:XJTLU_Admin_Lib.JPG", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/" },
  unnc: { path: "/universities/unnc.jpg", author: "Yumeto", title: "20230912 Ningbo Nottingham Daxue.jpg", caption: "University of Nottingham Ningbo China, 2023", sourceUrl: "https://commons.wikimedia.org/wiki/File:20230912_Ningbo_Nottingham_Daxue.jpg", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" },
  "taylors": {"title":"Taylor's Lakeside Campus, Subang Jaya, Malaysia.jpg","author":"Md Shaifuzzaman Ayon","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0/","caption":"Корпуса Taylor’s University у озера, Lakeside Campus, Субанг-Джая, 2022","sourceUrl":"https://commons.wikimedia.org/wiki/File:Taylor%27s_Lakeside_Campus%2C_Subang_Jaya%2C_Malaysia.jpg","path":"https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Taylor%27s_Lakeside_Campus%2C_Subang_Jaya%2C_Malaysia.jpg/960px-Taylor%27s_Lakeside_Campus%2C_Subang_Jaya%2C_Malaysia.jpg"},
  "inti": {"title":"INTI Nilai Student Centre.png","author":"Anthony5429","license":"Public domain (PD-self)","licenseUrl":"https://commons.wikimedia.org/wiki/File:INTI_Nilai_Student_Centre.png","caption":"Студенческий центр INTI в Нилае, 2007","sourceUrl":"https://commons.wikimedia.org/wiki/File:INTI_Nilai_Student_Centre.png","path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/5/50/INTI_Nilai_Student_Centre.png/330px-INTI_Nilai_Student_Centre.png"},
  "ucsi": {"title":"UCSI main gate Taman Connaught (231105).jpg","author":"*angys*","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0/","caption":"Главный въезд UCSI University в Taman Connaught, Куала-Лумпур, 2023","sourceUrl":"https://commons.wikimedia.org/wiki/File:UCSI_main_gate_Taman_Connaught_(231105).jpg","path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/4/46/UCSI_main_gate_Taman_Connaught_%28231105%29.jpg/960px-UCSI_main_gate_Taman_Connaught_%28231105%29.jpg"},
  "xiamen-malaysia": {"title":"XMUM entrance (211127).jpg","author":"*angys*","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0/","caption":"Вход и корпуса малайзийского кампуса Xiamen University, Сепанг, 2021","sourceUrl":"https://commons.wikimedia.org/wiki/File:XMUM_entrance_(211127).jpg","path":"https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/XMUM_entrance_%28211127%29.jpg/960px-XMUM_entrance_%28211127%29.jpg"},
  "monash-malaysia": {"title":"Monash University Malaysia (221208) 01.jpg","author":"*angys*","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0/","caption":"Вход в Monash University Malaysia и соединённые переходом корпуса, 2022","sourceUrl":"https://commons.wikimedia.org/wiki/File:Monash_University_Malaysia_(221208)_01.jpg","path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/7/77/Monash_University_Malaysia_%28221208%29_01.jpg/960px-Monash_University_Malaysia_%28221208%29_01.jpg"},
  "scut": {"title":"South China University of Technology South Campus.jpg","author":"LPS.1","license":"CC0 1.0","licenseUrl":"https://creativecommons.org/publicdomain/zero/1.0/","caption":"Корпуса SCUT у воды, University Town Campus, Гуанчжоу, 2012","sourceUrl":"https://commons.wikimedia.org/wiki/File:South_China_University_of_Technology_South_Campus.jpg","path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/1/13/South_China_University_of_Technology_South_Campus.jpg/960px-South_China_University_of_Technology_South_Campus.jpg"},
  "zjut": {"title":"20250423 Zhejiang Gongye Daxue.jpg","author":"Yumeto","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0/","caption":"Входной корпус Zhejiang University of Technology, Ханчжоу, 2025","sourceUrl":"https://commons.wikimedia.org/wiki/File:20250423_Zhejiang_Gongye_Daxue.jpg","path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e3/20250423_Zhejiang_Gongye_Daxue.jpg/960px-20250423_Zhejiang_Gongye_Daxue.jpg"},
  "gdut": {"title":"广工大东风路校区南苑大门.jpg","author":"Lhzss8","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0/","caption":"Вход в южную часть Dongfeng Road Campus, Guangdong University of Technology, 2025","sourceUrl":"https://commons.wikimedia.org/wiki/File:%E5%B9%BF%E5%B7%A5%E5%A4%A7%E4%B8%9C%E9%A3%8E%E8%B7%AF%E6%A0%A1%E5%8C%BA%E5%8D%97%E8%8B%91%E5%A4%A7%E9%97%A8.jpg","path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d6/%E5%B9%BF%E5%B7%A5%E5%A4%A7%E4%B8%9C%E9%A3%8E%E8%B7%AF%E6%A0%A1%E5%8C%BA%E5%8D%97%E8%8B%91%E5%A4%A7%E9%97%A8.jpg/960px-%E5%B9%BF%E5%B7%A5%E5%A4%A7%E4%B8%9C%E9%A3%8E%E8%B7%AF%E6%A0%A1%E5%8C%BA%E5%8D%97%E8%8B%91%E5%A4%A7%E9%97%A8.jpg"},
  "upc-east-china": {"title":"中国石油大学黄岛校区南侧.jpg","author":"Suginami","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0/","caption":"Южная сторона кампуса UPC (East China), Хуандао, Циндао, 2023","sourceUrl":"https://commons.wikimedia.org/wiki/File:%E4%B8%AD%E5%9B%BD%E7%9F%B3%E6%B2%B9%E5%A4%A7%E5%AD%A6%E9%BB%84%E5%B2%9B%E6%A0%A1%E5%8C%BA%E5%8D%97%E4%BE%A7.jpg","path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8e/%E4%B8%AD%E5%9B%BD%E7%9F%B3%E6%B2%B9%E5%A4%A7%E5%AD%A6%E9%BB%84%E5%B2%9B%E6%A0%A1%E5%8C%BA%E5%8D%97%E4%BE%A7.jpg/960px-%E4%B8%AD%E5%9B%BD%E7%9F%B3%E6%B2%B9%E5%A4%A7%E5%AD%A6%E9%BB%84%E5%B2%9B%E6%A0%A1%E5%8C%BA%E5%8D%97%E4%BE%A7.jpg"},
  "ecust": {"title":"ECUST gate Xuhui.jpg","author":"4084470 0.smil","license":"CC BY-SA 4.0","licenseUrl":"https://creativecommons.org/licenses/by-sa/4.0/","caption":"Главный вход ECUST, Xuhui Campus, Шанхай, 2020","sourceUrl":"https://commons.wikimedia.org/wiki/File:ECUST_gate_Xuhui.jpg","path":"https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e5/ECUST_gate_Xuhui.jpg/960px-ECUST_gate_Xuhui.jpg"},
} as const;
export type UniversityPhotoKey = keyof typeof UNIVERSITY_PHOTOS;
export type UniversityIntake = Readonly<{
  label: string; startDate: string | null; startMonth: string | null;
  applicationDeadline: string | null; deadlineTime: string | null; timezone: string | null;
  status: "announced" | "open" | "closed" | "unknown" | "needs_reconfirmation";
  note: string; sourceUrl: string; verifiedOn: string;
}>;
export type UniversityProgram = Readonly<{
  id: string; title: string; level: UniversityLevel; duration: string | null; language: string | null;
  summary: string; sourceUrl: string; intakes: readonly UniversityIntake[];
}>;
export type UniversityContent = Readonly<{
  name: string; country: string; city: string | null; overview: string;
  websiteUrl: string; sourceUrl: string; verifiedOn: string; notes: string;
  photoKey: UniversityPhotoKey | null; programs: readonly UniversityProgram[];
}>;
export type PublishedUniversity = Readonly<{ id: string; version: number; publishedAt: string; content: UniversityContent }>;
export type UniversityDraft = Readonly<{ id: string; institutionId: string | null; baseVersion: number; createdAt: string; status: "draft"; content: UniversityContent; reason: string }>;
export type UniversityFilters = Readonly<{ query: string; country: string; level: UniversityLevel | ""; offset: number }>;
export type UniversityPage = Readonly<{ items: readonly PublishedUniversity[]; nextOffset: number | null }>;
export type UniversityActionState = Readonly<{ status: "idle" | "saved" | "published" | "rejected" | "invalid" | "forbidden" | "stale" | "request_conflict" | "unavailable"; requestId: string; draftId: string | null; institutionId: string | null }>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function universityUuid(value: unknown): string | null { return typeof value === "string" && UUID.test(value) ? value : null; }
function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function exact(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)); }
function text(value: unknown, max: number, empty = false): value is string { return typeof value === "string" && (empty || value.trim().length > 0) && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value); }
export function universityDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) > 0 && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
/** Display-only links. No server fetching, credentials, ports or private literals. */
export function universityPublicUrl(value: unknown): value is string {
  if (!text(value, 1000) || !value.startsWith("https://") || /[\s\\#]/.test(value) || /[?&][^=&]*%[^=&]*(?:=|&|$)/.test(value)) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.hash
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)
    && !/\.(?:localhost|local|internal|test|invalid|example)$/.test(url.hostname)
    && ![...url.searchParams.keys()].some((key) => /token|secret|password|auth|api.?key/i.test(key)); } catch { return false; }
}
export function parseUniversityContent(value: unknown): UniversityContent | null {
  const row = object(value);
  if (!row || !exact(row, ["name", "country", "city", "overview", "websiteUrl", "sourceUrl", "verifiedOn", "notes", "photoKey", "programs"])) return null;
  if (!text(row.name, 300) || !text(row.country, 2) || !/^[A-Z]{2}$/.test(row.country)
    || !(row.city === null || text(row.city, 200)) || !text(row.overview, 1200)
    || !universityPublicUrl(row.websiteUrl) || !universityPublicUrl(row.sourceUrl) || !universityDate(row.verifiedOn)
    || !text(row.notes, 1500, true) || !(row.photoKey === null || (typeof row.photoKey === "string" && Object.hasOwn(UNIVERSITY_PHOTOS, row.photoKey)))
    || !Array.isArray(row.programs) || row.programs.length < 1 || row.programs.length > 30) return null;
  const programs: UniversityProgram[] = [];
  for (const entry of row.programs) {
    const program = object(entry);
    if (!program || !exact(program, ["id", "title", "level", "duration", "language", "summary", "sourceUrl", "intakes"])
      || !text(program.id, 64) || !/^[a-z0-9][a-z0-9-]*$/.test(program.id) || programs.some((p) => p.id === program.id)
      || !text(program.title, 300) || !UNIVERSITY_LEVELS.includes(program.level as UniversityLevel)
      || !(program.duration === null || text(program.duration, 150)) || !(program.language === null || text(program.language, 100))
      || !text(program.summary, 1200, true) || !universityPublicUrl(program.sourceUrl)
      || !Array.isArray(program.intakes) || program.intakes.length > 12) return null;
    const intakes: UniversityIntake[] = [];
    for (const item of program.intakes) {
      const intake = object(item);
      if (!intake || !exact(intake, ["label", "startDate", "startMonth", "applicationDeadline", "deadlineTime", "timezone", "status", "note", "sourceUrl", "verifiedOn"])
        || !text(intake.label, 200) || !(intake.startDate === null || universityDate(intake.startDate))
        || !(intake.startMonth === null || (typeof intake.startMonth === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(intake.startMonth)))
        || !(intake.applicationDeadline === null || universityDate(intake.applicationDeadline))
        || !(intake.deadlineTime === null || (typeof intake.deadlineTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(intake.deadlineTime)))
        || !(intake.timezone === null || text(intake.timezone, 100))
        || (intake.deadlineTime !== null && (intake.applicationDeadline === null || intake.timezone === null))
        || (intake.startDate !== null && intake.startMonth !== null && intake.startDate.slice(0, 7) !== intake.startMonth)
        || !["announced", "open", "closed", "unknown", "needs_reconfirmation"].includes(intake.status as string)
        || !text(intake.note, 1000, true) || !universityPublicUrl(intake.sourceUrl) || !universityDate(intake.verifiedOn)) return null;
      try { if (intake.timezone !== null) new Intl.DateTimeFormat("en", { timeZone: intake.timezone as string }); } catch { return null; }
      intakes.push(intake as unknown as UniversityIntake);
    }
    programs.push({ ...(program as unknown as UniversityProgram), intakes });
  }
  // A closed DTO: no raw source metadata, notes outside these public fields, or authority IDs.
  return { name: row.name, country: row.country, city: row.city, overview: row.overview, websiteUrl: row.websiteUrl, sourceUrl: row.sourceUrl, verifiedOn: row.verifiedOn, notes: row.notes, photoKey: row.photoKey as UniversityPhotoKey | null, programs };
}
export function universityIntakeLabel(intake: UniversityIntake, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: intake.timezone ?? "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const at = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
  const day = `${at("year")}-${at("month")}-${at("day")}`;
  if (intake.status === "closed" || (intake.applicationDeadline && (intake.applicationDeadline < day || (intake.applicationDeadline === day && intake.deadlineTime && intake.deadlineTime < `${at("hour")}:${at("minute")}`)))) return "Приём по опубликованному сроку закрыт";
  if (intake.status === "needs_reconfirmation") return "Дату нужно подтвердить";
  if (intake.status === "open") return "Приём открыт по данным источника";
  if (intake.status === "announced") return "Набор объявлен; доступность уточняется";
  return "Условия набора требуют уточнения";
}
export function parseUniversityFilters(params: Record<string, string | string[] | undefined>): UniversityFilters | null {
  if (Object.entries(params).some(([key, value]) => !["q", "country", "level", "offset"].includes(key) || Array.isArray(value))) return null;
  const query = typeof params.q === "string" ? params.q : "", country = typeof params.country === "string" ? params.country : "", level = typeof params.level === "string" ? params.level : "", rawOffset = typeof params.offset === "string" ? params.offset : "0";
  if (!text(query, 100, true) || (country !== "" && !/^[A-Z]{2}$/.test(country)) || (level !== "" && !UNIVERSITY_LEVELS.includes(level as UniversityLevel)) || !/^(0|[1-9]\d{0,4})$/.test(rawOffset) || Number(rawOffset) > 50000) return null;
  return { query, country, level: level as UniversityFilters["level"], offset: Number(rawOffset) };
}
export function parseUniversityPage(value: unknown): UniversityPage | null {
  const page = object(value);
  if (!page || !exact(page, ["items", "nextOffset"]) || !Array.isArray(page.items) || page.items.length > 30 || !(page.nextOffset === null || (Number.isSafeInteger(page.nextOffset) && Number(page.nextOffset) >= 0 && Number(page.nextOffset) <= 50030))) return null;
  const items: PublishedUniversity[] = [];
  for (const entry of page.items) {
    const row = object(entry), content = parseUniversityContent(row?.content), id = universityUuid(row?.id);
    if (!row || !exact(row, ["id", "version", "publishedAt", "content"]) || !id || items.some((item) => item.id === id) || !content || !Number.isSafeInteger(row.version) || Number(row.version) < 1 || typeof row.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(row.publishedAt) || Number.isNaN(Date.parse(row.publishedAt))) return null;
    items.push({ id, version: row.version as number, publishedAt: row.publishedAt, content });
  }
  return { items, nextOffset: page.nextOffset as number | null };
}
export function parseUniversityDrafts(value: unknown): readonly UniversityDraft[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const drafts: UniversityDraft[] = [];
  for (const entry of value) {
    const row = object(entry), content = parseUniversityContent(row?.content), id = universityUuid(row?.id);
    if (!row || !exact(row, ["id", "institutionId", "baseVersion", "createdAt", "content", "reason", "status"]) || !id || drafts.some((draft) => draft.id === id) || !content || !(row.institutionId === null || universityUuid(row.institutionId)) || !Number.isSafeInteger(row.baseVersion) || Number(row.baseVersion) < 0 || !text(row.reason, 500) || row.status !== "draft" || typeof row.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(row.createdAt) || Number.isNaN(Date.parse(row.createdAt))) return null;
    drafts.push({ id, institutionId: row.institutionId as string | null, baseVersion: row.baseVersion as number, createdAt: row.createdAt, content, reason: row.reason, status: "draft" });
  }
  return drafts;
}
