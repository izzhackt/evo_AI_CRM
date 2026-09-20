import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import {
  parseConsultationHistory,
  type ConsultationReceipt,
} from "./consultation";

/**
 * Серверное чтение собственной истории запросов консультации (PORT-5b,
 * миграция 197). RPC выводит актора из живой Student-сессии; здесь —
 * транспорт и строгий разбор, неполная форма — честная ошибка.
 */
export async function readOwnConsultationRequests(): Promise<readonly ConsultationReceipt[]> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .schema("platform")
    .rpc("own_portal_consultation_requests_v1");
  const history = !error && parseConsultationHistory(data);
  if (!history) throw new Error("Consultation history unavailable");
  return history;
}
