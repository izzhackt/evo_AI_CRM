/**
 * «Откуда узнал» (миграция 264, план «Маркетинг» §3.2): выбор сотрудника и ответ
 * `platform.read_lead_channel_v1`. Канал — отдельное измерение от канала связи
 * `leads.source_key`; порядок и подписи фиксированы планом, «Не известно» всегда
 * последнее. Любое расхождение формы ответа — `null`: экран говорит «не прочитано»,
 * а не рисует канал наугад («нет чтения — нет числа»).
 */
export const LEAD_CHANNELS = {
  instagram_ads: "Instagram — реклама",
  instagram: "Instagram — посты и профиль",
  website_search: "Сайт и поиск",
  referral: "Рекомендация",
  other: "Другое",
  unknown: "Не известно",
} as const;
export type LeadChannel = keyof typeof LEAD_CHANNELS;
export const LEAD_CHANNEL_KEYS = Object.keys(LEAD_CHANNELS) as readonly LeadChannel[];

/** Основание канала: на чём он держится. UTM — заявленное значение, не доказанное, поэтому слова «доказано» нет. */
export const LEAD_CHANNEL_BASES = {
  utm: "по метке",
  referrer: "по ссылке",
  staff: "со слов клиента",
  corrected: "исправлено",
  unknown: "не известно",
} as const;
export type LeadChannelBasis = keyof typeof LEAD_CHANNEL_BASES;

export const LEAD_CHANNEL_REQUIRED = "Выберите, откуда узнал клиент";
export const LEAD_CHANNEL_UNKNOWN_HINT = "Спросите клиента";
export const LEAD_CHANNEL_AI_NOTE = "ИИ-ассистент";

export type LeadChannelRead = Readonly<{
  channel: LeadChannel;
  basis: LeadChannelBasis;
  corrected: boolean;
  /** Время решающего касания; null — касаний нет. */
  at: string | null;
}>;

export type LeadChannelState =
  | Readonly<{ status: "available"; read: LeadChannelRead }>
  | Readonly<{ status: "unavailable" }>;

/** Состояние формы исправления в Lead 360 (`staff_correction`). */
export type LeadChannelCorrectionState = Readonly<{
  status: "idle" | "saved" | "invalid" | "forbidden" | "request_conflict" | "unavailable";
  requestId: string;
  read: LeadChannelRead | null;
}>;

export function isLeadChannel(value: unknown): value is LeadChannel {
  return typeof value === "string" && Object.hasOwn(LEAD_CHANNELS, value);
}
export function isLeadChannelBasis(value: unknown): value is LeadChannelBasis {
  return typeof value === "string" && Object.hasOwn(LEAD_CHANNEL_BASES, value);
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

/** Ровно `{channel, basis, corrected, at}`; «исправлено» и `corrected` обязаны совпадать. */
export function parseLeadChannelRead(value: unknown): LeadChannelRead | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.length !== 4 || !["channel", "basis", "corrected", "at"].every((key) => keys.includes(key))) return null;
  if (!isLeadChannel(row.channel) || !isLeadChannelBasis(row.basis) || typeof row.corrected !== "boolean"
    || (row.at !== null && !isIsoTimestamp(row.at)) || row.corrected !== (row.basis === "corrected")) return null;
  return Object.freeze({ channel: row.channel, basis: row.basis, corrected: row.corrected, at: row.at });
}

/** «Instagram — реклама · по метке». */
export function leadChannelText(read: Pick<LeadChannelRead, "channel" | "basis">): string {
  return `${LEAD_CHANNELS[read.channel]} · ${LEAD_CHANNEL_BASES[read.basis]}`;
}
