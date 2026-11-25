// «Запись на консультацию» (веб: ConsultationRequest.tsx, consultation-actions.ts, consultation-source.ts; миграция 197).
// Два RPC платформы, оба от имени студента: `own_portal_consultation_requests_v1` (своя история, до 20 запросов) и
// `create_portal_consultation_request_v1` (запрос; база держит не более одного открытого запроса на участника и идемпотентна по
// `p_request_id`: повтор нажатия и повтор после обрыва связи возвращают тот же запрос, дубля не будет). Разбор ответов - строгие
// разборщики веба.
import {
  CONSULTATION_NOTE_LIMIT,
  parseConsultationHistory,
  parseConsultationReceipt,
  type ConsultationReceipt,
} from "@web/lib/portal/consultation";

import { createWrite, rpcRead, rpcWrite, type FrozenWrite, type RpcTransport } from "@/lib/rpc";

export { CONSULTATION_NOTE_LIMIT };

export class ConsultationDecodeError extends Error {
  constructor() {
    super("consultation:decode");
    this.name = "ConsultationDecodeError";
  }
}

/** Своя история запросов. Чужая форма ответа - ошибка, а не пустая история (экран говорит «не удалось загрузить»). */
export async function readConsultationHistory(transport: RpcTransport): Promise<readonly ConsultationReceipt[]> {
  const history = parseConsultationHistory(await rpcRead(transport, "own_portal_consultation_requests_v1"));
  if (!history) throw new ConsultationDecodeError();
  return history;
}

/**
 * Запись запроса. `requestId` стабилен, пока запрос не принят (веб: один `crypto.randomUUID()` на форму): повтор после сбоя
 * шлёт тот же id, база вернёт уже созданный запрос. Заметка обрезается по краям, пустая уходит как `null`; вуз `null` - запрос из
 * «Профиля».
 */
export function consultationWrite(requestId: string, institutionId: string | null, note: string): FrozenWrite {
  const trimmed = note.trim();
  return createWrite(
    "create_portal_consultation_request_v1",
    { p_institution_id: institutionId, p_note: trimmed === "" ? null : trimmed },
    { requestId },
  );
}

/** Отправка. Ответ обязан быть квитанцией запроса: пустой или чужой ответ не считается принятым. */
export async function sendConsultation(transport: RpcTransport, write: FrozenWrite): Promise<ConsultationReceipt> {
  const receipt = parseConsultationReceipt(await rpcWrite(transport, write));
  if (!receipt) throw new ConsultationDecodeError();
  return receipt;
}
