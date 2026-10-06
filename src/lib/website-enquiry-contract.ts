export const WEBSITE_ENQUIRY_COUNTRIES = new Set([
  "China", "Malaysia", "Europe", "Germany", "United Kingdom", "Italy",
  "Netherlands", "France", "Poland", "Czechia", "Austria", "Cyprus",
  "United Arab Emirates", "Turkey", "Undecided",
]);

export type WebsiteEnquiryUniversity = Readonly<{ slug: string; name: string }>;

/** Visitor-supplied context, not an authoritative CRM university association. */
export function parseWebsiteEnquiryUniversity(value: unknown): WebsiteEnquiryUniversity | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid website university.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || !Object.hasOwn(input, "slug") || !Object.hasOwn(input, "name")
    || typeof input.slug !== "string" || input.slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)
    || typeof input.name !== "string" || input.name.length > 300 || input.name.trim().length === 0
    || /[\u0000-\u001f\u007f]/.test(input.name)) throw new Error("Invalid website university.");
  return { slug: input.slug, name: input.name.trim() };
}

export type WebsiteEnquiryAttribution = Readonly<Record<string, string | true>>;

const ATTRIBUTION_KINDS = {
  utm_source: "token", utm_medium: "token", utm_campaign: "label", utm_content: "label", utm_term: "label",
  utm_id: "id", referrer_host: "host", landing_path: "path",
} as const;
const ATTRIBUTION_MAX = { token: 100, label: 100, id: 20, host: 253, path: 200 } as const;
const ATTRIBUTION_SHAPE = {
  token: /^[A-Za-z0-9_.:~-]+$/,
  label: /^[A-Za-z0-9Ѐ-ӿ_.:~ -]+$/,
  id: /^[0-9]{1,20}$/,
  host: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
  path: /^\/[A-Za-z0-9_.~/%:+,=-]*$/,
} as const;
const ATTRIBUTION_SEEN_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)$/;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function attributionValue(value: unknown, kind: keyof typeof ATTRIBUTION_SHAPE): string | null {
  if (typeof value !== "string") return null;
  // Как btrim в SQL: только пробелы, чтобы сайт и база отбрасывали одно и то же.
  const v = value.replace(/^ +| +$/g, "");
  if (v === "") return null;
  if (kind === "id") return ATTRIBUTION_SHAPE.id.test(v) ? v : null;
  if (v.length > ATTRIBUTION_MAX[kind] || v.includes("@") || /%40/i.test(v) || /[0-9]{7,}/.test(v)) return null;
  const candidate = kind === "host" ? v.toLowerCase() : v;
  return ATTRIBUTION_SHAPE[kind].test(candidate) ? candidate : null;
}

/**
 * Необязательные метки перехода (план «Маркетинг» §8 С4). Правила те же, что у
 * `platform_private.sanitize_lead_attribution` (263): плохое значение
 * отбрасывается, заявка принимается — из-за меток ответа 400 не бывает. Неизвестные
 * ключи отбрасываются; `fbclid` превращается в признак `has_fbclid` и дальше не идёт.
 * `null` — пересылать нечего (`seen_at` один — не метка).
 */
export function parseWebsiteEnquiryAttribution(value: unknown, now: number = Date.now()): WebsiteEnquiryAttribution | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.hasOwn(input, "v") && input.v !== 1) return null;
  const result: Record<string, string | true> = {};
  for (const [key, kind] of Object.entries(ATTRIBUTION_KINDS)) {
    const clean = Object.hasOwn(input, key) ? attributionValue(input[key], kind) : null;
    if (clean !== null) result[key] = clean;
  }
  if (input.has_fbclid === true
    || (Object.hasOwn(input, "fbclid") && typeof input.fbclid === "string" && input.fbclid.trim().length > 0 && input.fbclid.length <= 1000)) {
    result.has_fbclid = true;
  }
  if (Object.keys(result).length === 0) return null;
  if (typeof input.seen_at === "string" && ATTRIBUTION_SEEN_AT.test(input.seen_at)) {
    // `+05` без минут SQL принимает, а Date.parse — нет: достраиваем `:00`.
    const at = Date.parse(input.seen_at.replace(/([+-]\d{2})$/, "$1:00"));
    if (Number.isFinite(at) && at <= now && at >= now - THIRTY_DAYS_MS) result.seen_at = new Date(at).toISOString();
  }
  return result;
}
