import "server-only";

import { createSupabaseServerClient } from "../supabase/server";
import { parseStudentCountryChoice, type StudentCountryChoice } from "./country-choice";

/**
 * Выбор страны студента для «Пути поступления» (миграция 284). RPC выводит
 * студента из живой сессии; параметров нет. Отказ или неверная форма ответа
 * бросают ошибку: «Главная» показывает честную плашку, а не выдуманную страну.
 */
export async function readStudentCountryChoice(): Promise<StudentCountryChoice> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.schema("platform").rpc("student_country_choice_v1");
  const choice = error ? null : parseStudentCountryChoice(data);
  if (!choice) throw new Error("Country choice unavailable");
  return choice;
}
