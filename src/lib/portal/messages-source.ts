import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import {
  parsePortalCaseMessagesPage,
  type PortalCaseMessagesPage,
} from "./messages";

/**
 * Серверное чтение СВОЕГО треда по делу (PORT-5c, миграция 200). RPC выводит
 * актора и кейс из живой Student-сессии (гейт 192, assisted-only); здесь —
 * транспорт и строгий разбор, неполная форма — честная ошибка.
 */
export async function readPortalCaseMessages(
  beforeSequenceId: string | null = null,
): Promise<PortalCaseMessagesPage> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .schema("platform")
    .rpc("portal_case_chat_page_v1", {
      p_before_sequence_id: beforeSequenceId,
    }, { get: true });
  const page = !error && parsePortalCaseMessagesPage(data);
  if (!page) throw new Error("Case messages unavailable");
  return page;
}
