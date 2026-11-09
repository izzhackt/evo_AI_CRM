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

export type StoredDraft = Readonly<{ values: WizardValues; step: number }>;

const keyOf = (scope: DraftScope) => `${DRAFT_PREFIX}:${scope}`;

/** Ровно то, что уходит в хранилище: ни пароля, ни согласий. */
export function serializeDraft(values: WizardValues, step: number): string {
  // Явная копия без `consent`: даже ошибка вызывающего кода не сохранит согласие.
  const { consent: _consent, ...rest } = values;
  return JSON.stringify({ v: 1, step, values: rest });
}

export async function saveDraft(scope: DraftScope, values: WizardValues, step: number): Promise<void> {
  try {
    await AsyncStorage.setItem(keyOf(scope), serializeDraft(values, step));
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
    await SecureStore.setItemAsync(INVITE_KEY, token);
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
