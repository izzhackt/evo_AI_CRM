// Смена пароля из «Профиля» (веб: PasswordChangeForm + changeStudentPasswordAction, приложение: S4 с
// `current_password`). Здесь состояние формы и порядок вызовов без экрана и без сети: проверка полей
// теми же правилами, что на вебе (`checkStudentNewPassword`), один вызов сервера, один повтор после обновления
// сессии на 401. Тексты ошибок сервера наружу не идут: только классы исходов.
import { checkStudentNewPassword } from "@web/lib/student-password-recovery-contract";
import {
  STUDENT_PASSWORD_CHANGE_MESSAGE_KEY,
  type StudentPasswordChangeStatus,
} from "@web/lib/student-password-change-contract";

import type { ChangePasswordResult } from "@/api/portal-auth";

/** Исходы веба плюс два, которых там нет: нет связи и аккаунт сотрудника. */
export type PasswordChangeStatus = StudentPasswordChangeStatus | "offline" | "staff_account";

export type PasswordChangeInput = Readonly<{ current: string; next: string; confirm: string }>;

/** Локальная проверка до отправки: тот же порядок, что в `changeStudentPasswordAction`. */
export function validatePasswordChange(input: PasswordChangeInput): Exclude<PasswordChangeStatus, "idle" | "done"> | null {
  if (input.current.length === 0) return "wrong_current";
  const check = checkStudentNewPassword(input.next, input.confirm);
  if (check !== "ok") return check;
  if (input.current === input.next) return "same_password";
  return null;
}

export type PasswordChangeDeps = Readonly<{
  changeOwnPassword: (accessToken: string, current: string, next: string) => Promise<ChangePasswordResult>;
  getAccessToken: () => Promise<string | null>;
  /** Обновить сессию один раз; `null`: не вышло. */
  refreshAccessToken: () => Promise<string | null>;
}>;

function fromFailure(reason: Extract<ChangePasswordResult, { ok: false }>["reason"]): PasswordChangeStatus {
  switch (reason) {
    case "wrong_current":
      return "wrong_current";
    case "weak_password":
      return "rejected";
    case "same_password":
      return "same_password";
    case "rate_limited":
      return "rate_limited";
    case "staff_account":
      return "staff_account";
    case "network":
      return "offline";
    case "unauthorized":
      return "sign_in_required";
    default:
      return "unavailable";
  }
}

/**
 * Проверка, затем сервер. 401: сессия обновляется ровно один раз и запрос повторяется с новым токеном;
 * повторный 401 (или нет токена) — `sign_in_required`, и экран уводит на вход. 503 `revoke_failed`
 * сервер уже сообщил как успех на уровне `ChangePasswordResult` (пароль сменён).
 */
export async function submitPasswordChange(deps: PasswordChangeDeps, input: PasswordChangeInput): Promise<PasswordChangeStatus> {
  const local = validatePasswordChange(input);
  if (local) return local;
  let token = await deps.getAccessToken();
  if (!token) token = await deps.refreshAccessToken();
  if (!token) return "sign_in_required";
  let result = await deps.changeOwnPassword(token, input.current, input.next);
  if (!result.ok && result.reason === "unauthorized") {
    const fresh = await deps.refreshAccessToken();
    if (!fresh) return "sign_in_required";
    result = await deps.changeOwnPassword(fresh, input.current, input.next);
  }
  return result.ok ? "done" : fromFailure(result.reason);
}

/** Ключ строки словаря `profile` веба для исхода; у `idle`, `offline` и `staff_account` строк там нет. */
export function webMessageKey(status: PasswordChangeStatus): (typeof STUDENT_PASSWORD_CHANGE_MESSAGE_KEY)[keyof typeof STUDENT_PASSWORD_CHANGE_MESSAGE_KEY] | null {
  if (status === "idle" || status === "offline" || status === "staff_account") return null;
  return STUDENT_PASSWORD_CHANGE_MESSAGE_KEY[status];
}
