// Черновик анкеты на устройстве (#1362: «минимум постоянное хранилище»). Пароль и согласия
// сюда не попадают никогда: хранятся только ответы анкеты, шаг и почта. Личная ссылка
// лежит отдельно, в защищённом хранилище, и стирается после принятия регистрации.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { isInviteToken } from "@/features/registration/invite-link";
import { restoreStep, restoreValues, type WizardValues } from "@/features/registration/wizard-model";

const DRAFT_PREFIX = "evo.application-draft.v1";
const INVITE_KEY = "evo.registration-invite.v1";

/** Область черновика: анонимная регистрация или вошедший студент с номером ревизии. */
export type DraftScope = "anonymous" | `user:${string}`;

/** Черновик старше этого срока удаляется при чтении: анкета не лежит на устройстве вечно. */
export const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type StoredDraft = Readonly<{ values: WizardValues; step: number }>;

const keyOf = (scope: DraftScope) => `${DRAFT_PREFIX}:${scope}`;

/** Непрозрачная область черновика вошедшего студента: почта в ключ хранилища не попадает (cyrb53, не секрет). */
export function userDraftScope(email: string, revision: number): DraftScope {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const ch of email.trim().toLowerCase()) {
    const c = ch.charCodeAt(0);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  return `user:${hash}:${revision}`;
}

/** Ровно то, что уходит в хранилище: ни пароля, ни согласий. */
export function serializeDraft(values: WizardValues, step: number, createdAt: number = Date.now()): string {
  // Явная копия без `consent`: даже ошибка вызывающего кода не сохранит согласие.
  const { consent: _consent, ...rest } = values;
  return JSON.stringify({ v: 1, createdAt, step, values: rest });
}

export async function saveDraft(scope: DraftScope, values: WizardValues, step: number): Promise<void> {
  try {
    let createdAt = Date.now();
    try {
      const prev: unknown = JSON.parse((await AsyncStorage.getItem(keyOf(scope))) ?? "null");
      const prevAt = (prev as { createdAt?: unknown } | null)?.createdAt;
      if (typeof prevAt === "number" && Date.now() - prevAt < DRAFT_MAX_AGE_MS) createdAt = prevAt;
    } catch {
      // прежнего черновика нет или он повреждён
    }
    await AsyncStorage.setItem(keyOf(scope), serializeDraft(values, step, createdAt));
  } catch {
    // Хранилище недоступно: мастер работает, но «сохранено» не обещает.
  }
}

export async function loadDraft(scope: DraftScope, base: WizardValues): Promise<StoredDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyOf(scope));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    // Без отметки времени (старый формат) или старше 30 дней: удалить и начать заново.
    if (typeof record.createdAt !== "number" || Date.now() - record.createdAt > DRAFT_MAX_AGE_MS) {
      await AsyncStorage.removeItem(keyOf(scope));
      return null;
    }
    return { values: restoreValues(record.values, base), step: restoreStep(record.step) };
  } catch {
    return null;
  }
}

export async function clearDraft(scope: DraftScope): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyOf(scope));
  } catch {
    // нечего чистить
  }
}

export async function saveInviteToken(token: string): Promise<void> {
  if (!isInviteToken(token)) return;
  try {
    await SecureStore.setItemAsync(INVITE_KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  } catch {
    // без защищённого хранилища ссылка живёт только в памяти экрана
  }
}

export async function loadInviteToken(): Promise<string | null> {
  try {
    const value = await SecureStore.getItemAsync(INVITE_KEY);
    return isInviteToken(value) ? value : null;
  } catch {
    return null;
  }
}

export async function clearInviteToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(INVITE_KEY);
  } catch {
    // нечего чистить
  }
}

/** Выход или смена пользователя: все черновики (анонимный и по студентам) и личная ссылка стираются. */
export async function clearRegistrationLocalData(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((key) => key.startsWith(DRAFT_PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // нечего чистить
  }
  await clearInviteToken();
}
