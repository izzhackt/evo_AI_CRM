export const MANUAL_LEAD_SOURCES = { office: "Встреча в офисе", phone_call: "Звонок", referral: "Рекомендация", website: "Сайт", other: "Другой источник" } as const;
/**
 * Источник выбирают явно (Э8.11): форма открывается на «Не выбрано», пустой
 * источник не сохраняется ни в браузере, ни на сервере. Ключи — прежние
 * пять: ручной источник WhatsApp или Instagram потребовал бы миграцию
 * проверки 143 и поставил бы ручного лида в очередь «Заявки» (221, 250).
 */
export const MANUAL_LEAD_SOURCE_REQUIRED = "Выберите источник";
export const LEAD_DIRECTIONS = { CN: "Китай", MY: "Малайзия", EU: "Европа", AE: "ОАЭ", TR: "Турция" } as const;
export type ManualLeadInput = Readonly<{
  requestId: string; name: string; phone: string | null; email: string | null;
  source: keyof typeof MANUAL_LEAD_SOURCES; ownerId: string;
  direction: keyof typeof LEAD_DIRECTIONS | null; nextAction: string | null; dueDate: string | null;
}>;
export type ManualLeadState = Readonly<{
  status: "idle" | "saved" | "duplicate" | "invalid" | "source_required" | "forbidden" | "request_conflict" | "unavailable";
  requestId: string; leadId: string | null;
}>;
