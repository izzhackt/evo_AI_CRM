/**
 * Чистые помощники «Запроса консультации» (PORT-5b, план §6 «Консультация»).
 * Серверный контракт — миграция 197. Файл клиент-безопасный.
 */
import { universityUuid } from "../platform-university-catalog.ts";

export type ConsultationStatus = "requested" | "handled";

export type ConsultationReceipt = Readonly<{
  requestId: string;
  status: ConsultationStatus;
  institutionId: string | null;
  institutionName: string | null;
  note: string | null;
  requestedAt: string;
  handledAt: string | null;
}>;

export type ConsultationActionResult =
  | Readonly<{ ok: true; receipt: ConsultationReceipt }>
  | Readonly<{ ok: false }>;

/** Лимит заметки — контракт миграции 197 (CHECK 1..500). */
export const CONSULTATION_NOTE_LIMIT = 500;

function timestamp(value: unknown): value is string {
  return (
    typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T/.test(value)
    && !Number.isNaN(Date.parse(value))
  );
}

/** Строгий разбор receipt: любое отклонение формы — null. */
export function parseConsultationReceipt(value: unknown): ConsultationReceipt | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(",")
    !== "handledAt,institutionId,institutionName,note,requestId,requestedAt,status"
  ) return null;
  if (
    !universityUuid(row.requestId)
    || (row.status !== "requested" && row.status !== "handled")
    || (row.institutionId !== null && !universityUuid(row.institutionId))
    || (row.institutionName !== null
      && (typeof row.institutionName !== "string" || row.institutionName.length > 300))
    || (row.note !== null
      && (typeof row.note !== "string" || row.note.length > CONSULTATION_NOTE_LIMIT))
    || !timestamp(row.requestedAt)
    || (row.status === "handled") !== (row.handledAt !== null)
    || (row.handledAt !== null && !timestamp(row.handledAt))
  ) return null;
  return {
    requestId: row.requestId as string,
    status: row.status,
    institutionId: row.institutionId as string | null,
    institutionName: row.institutionName as string | null,
    note: row.note as string | null,
    requestedAt: row.requestedAt,
    handledAt: row.handledAt as string | null,
  };
}

/** История own_portal_consultation_requests_v1 (потолок 20). */
export function parseConsultationHistory(value: unknown): readonly ConsultationReceipt[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const receipts: ConsultationReceipt[] = [];
  for (const entry of value) {
    const receipt = parseConsultationReceipt(entry);
    if (receipt === null) return null;
    receipts.push(receipt);
  }
  return Object.freeze(receipts);
}

/** Открытый запрос из истории; null — открытого нет. */
export function openConsultationRequest(
  history: readonly ConsultationReceipt[],
): ConsultationReceipt | null {
  return history.find((receipt) => receipt.status === "requested") ?? null;
}
