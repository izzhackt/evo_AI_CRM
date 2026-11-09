import "server-only";

import { randomUUID } from "node:crypto";

import { acceptConsentsFrom } from "../portal/consent-gate-rpc.ts";
import { createSupabaseServerClient } from "../supabase/server";

/**
 * Запись двух галочек экрана «Конфиденциальность» из формы, где студент уже отметил их (пароль по ссылке-приглашению,
 * пароль кабинета от администратора), от имени вошедшего студента. Сбой не мешает входу: экран кабинета спросит снова.
 * Возвращает, подтвердила ли база запись.
 */
export async function recordStudentConsentsAfterSignIn(): Promise<boolean> {
  try {
    return (await acceptConsentsFrom(createSupabaseServerClient, randomUUID())).ok;
  } catch {
    return false;
  }
}
