import "server-only";

import { redirect } from "next/navigation";

import { requireStudentPortalActor } from "../student-portal-guards";
import { cscaAvailableFor } from "./csca-home-card";
import { readStudentCountryChoice } from "./country-choice-source";

/**
 * Доступ к разделу CSCA по выбору страны (21.11.2026): только Китай. Выбор
 * читается тем же `readStudentCountryChoice` (React cache), что layout кабинета;
 * сбой чтения считается «не Китай». Layout не перезапускается при клиентской
 * навигации, поэтому проверку делает каждая страница и каждое действие.
 */
export async function cscaAccessForCurrentStudent(): Promise<boolean> {
  return cscaAvailableFor(await readStudentCountryChoice().catch((): null => null));
}

/** Для страниц: студент кабинета с выбором «Китай», иначе на «Главную». */
export async function requireCscaStudentPortalActor() {
  const actor = await requireStudentPortalActor();
  if (!(await cscaAccessForCurrentStudent())) redirect("/portal");
  return actor;
}
