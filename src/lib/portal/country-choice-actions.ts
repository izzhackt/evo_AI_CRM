"use server";

import { refresh } from "next/cache";

import { requireStudentPortalActor } from "../student-portal-guards";
import { createSupabaseServerClient } from "../supabase/server";
import { COUNTRY_CHOICE_VALUES, parseStudentCountryChoice } from "./country-choice";

export type CountryChoiceActionResult = Readonly<{ ok: true; country: string } | { ok: false }>;

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Сохранение выбора страны (миграция 284, контракт §4). Клиент создаёт новый
 * `requestId` на каждое действие и повторяет тот же при сбое сети: RPC
 * возвращает исходную квитанцию и ничего не меняет. После записи `refresh()`
 * перерисовывает «Главную» в том же ответе, и сервер заново читает
 * `student_country_choice_v1()`. Текст ошибки выбирает клиент по своей
 * локали; экшен отдаёт только результат.
 */
export async function setStudentCountryChoiceAction(
  country: unknown,
  requestId: unknown,
): Promise<CountryChoiceActionResult> {
  await requireStudentPortalActor();
  if (typeof country !== "string" || !COUNTRY_CHOICE_VALUES.includes(country)) return { ok: false };
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return { ok: false };
  let saved: string | null = null;
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .schema("platform")
      .rpc("set_student_country_choice_v1", { p_country: country, p_request_id: requestId });
    const receipt = error ? null : parseStudentCountryChoice(data);
    if (receipt?.source === "saved" && receipt.country === country) saved = receipt.country;
  } catch {
    return { ok: false };
  }
  if (saved === null) return { ok: false };
  refresh();
  return { ok: true, country: saved };
}
