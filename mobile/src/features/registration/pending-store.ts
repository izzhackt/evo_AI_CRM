// «Подтвердите почту» переживает перезапуск приложения (веб: httpOnly-cookie `evo_student_signup_pending` и `restored` в
// src/lib/server/student-signup-confirmation-web.ts, src/app/apply/page.tsx). После регистрации человек уходит читать
// письмо; если система выгрузила приложение, без этой записи «Отправить письмо ещё раз» пропадает, а экран «Регистрация по
// ссылке» просит ссылку, которой уже нет. Запись лежит в защищённом хранилище (в ней предъявитель повторной отправки), живёт
// до `expiresAt` сервера и стирается при входе, выходе и когда сервер сказал, что почта подтверждена или срок вышел.
import * as SecureStore from "expo-secure-store";

import type { PendingConfirmation } from "@/features/registration/registration-api";

const PENDING_KEY = "evo.registration-pending.v1";
/** Запись старше недели не читается, что бы ни стояло в `expiresAt`: страховка от чужой формы. */
const MAX_STORED_MS = 7 * 24 * 60 * 60 * 1000;

type Stored = Readonly<{ v: 1; savedAt: number; retryAt: number | null; pending: PendingConfirmation }>;

export type RestoredPending = Readonly<{ pending: PendingConfirmation; cooldownSeconds: number }>;

function isString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** Запись, снятая с диска, строго: чужая форма - ничего не восстанавливаем. */
function parseStored(raw: unknown): Stored | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const { v, savedAt, retryAt, pending } = record;
  if (v !== 1 || typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  if (retryAt !== null && !(typeof retryAt === "number" && Number.isFinite(retryAt))) return null;
  if (typeof pending !== "object" || pending === null) return null;
  const { maskedEmail, expiresAt, retryAfterSeconds, dispatch, resendCapability } = pending as Record<string, unknown>;
  if (!isString(maskedEmail, 320) || !isString(expiresAt, 64) || !isString(resendCapability, 1024)) return null;
  if (dispatch !== "accepted" && dispatch !== "failed" && dispatch !== "unknown") return null;
  if (retryAfterSeconds !== null && !(typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0)) return null;
  return { v: 1, savedAt, retryAt, pending: { maskedEmail, expiresAt, retryAfterSeconds, dispatch, resendCapability } };
}

export async function clearPendingSignup(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PENDING_KEY);
  } catch {
    // нечего чистить
  }
}

/** Запомнить ожидающую регистрацию; срок повторной отправки считается от сейчас. */
export async function savePendingSignup(pending: PendingConfirmation, now: number = Date.now()): Promise<void> {
  const stored: Stored = { v: 1, savedAt: now, retryAt: pending.retryAfterSeconds === null ? null : now + pending.retryAfterSeconds * 1000, pending };
  try {
    await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(stored), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  } catch {
    // без защищённого хранилища экран живёт только в памяти: как до этой правки
  }
}

/**
 * Ожидающая регистрация или `null` (нет записи, чужая форма, срок `expiresAt` вышел, запись старше недели). Негодную
 * запись стирает. `cooldownSeconds` - сколько ещё ждать до повторной отправки (0, если срок уже прошёл).
 */
export async function loadPendingSignup(now: number = Date.now()): Promise<RestoredPending | null> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let stored: Stored | null = null;
  try {
    stored = parseStored(JSON.parse(raw));
  } catch {
    stored = null;
  }
  const expires = stored ? Date.parse(stored.pending.expiresAt) : Number.NaN;
  if (!stored || !Number.isFinite(expires) || expires <= now || now - stored.savedAt > MAX_STORED_MS || stored.savedAt > now + 60_000) {
    await clearPendingSignup();
    return null;
  }
  const cooldownSeconds = stored.retryAt === null ? 0 : Math.max(0, Math.ceil((stored.retryAt - now) / 1000));
  return { pending: stored.pending, cooldownSeconds };
}
