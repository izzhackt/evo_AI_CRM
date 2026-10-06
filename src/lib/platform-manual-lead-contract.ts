export const MANUAL_LEAD_SOURCES = {
  office: "Встреча в офисе", phone_call: "Звонок", referral: "Рекомендация", website: "Сайт", other: "Другой источник",
  instagram: "Instagram Direct", whatsapp_manual: "WhatsApp (вручную)",
} as const;
/**
 * Источник выбирают явно (Э8.11): форма открывается на «Не выбрано», пустой
 * источник не сохраняется ни в браузере, ни на сервере. Решение 06.10
 * («Маркетинг», миграция 264) уточняет Э8.11: ручной список получил
 * `instagram` и `whatsapp_manual`, потому что лиды из Direct и WhatsApp
 * попадают в Платформу только вручную. Очередь «Заявки» (221, 250) по-прежнему
 * берёт только `website` и `whatsapp`, новые ключи в неё не попадают, а сам
 * `whatsapp` в ручной список не добавляется.
 */
export const MANUAL_LEAD_SOURCE_REQUIRED = "Выберите источник";
export const LEAD_DIRECTIONS = { CN: "Китай", MY: "Малайзия", EU: "Европа", AE: "ОАЭ", TR: "Турция" } as const;
export type ManualLeadInput = Readonly<{
  requestId: string; name: string; phone: string | null; email: string | null;
  source: keyof typeof MANUAL_LEAD_SOURCES; ownerId: string;
  direction: keyof typeof LEAD_DIRECTIONS | null; nextAction: string | null; dueDate: string | null;
}>;
export type ManualLeadState = Readonly<{
  status: "idle" | "saved" | "duplicate" | "invalid" | "source_required" | "channel_required" | "forbidden" | "request_conflict" | "unavailable";
  requestId: string; leadId: string | null;
  /**
   * «Откуда узнал» пишется отдельным вызовом после создания лида (миграция 264):
   * `failed` — лид есть, а выбор не записан, его ставят в Lead 360.
   */
  touch?: "saved" | "failed";
}>;
