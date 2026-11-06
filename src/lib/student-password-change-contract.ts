/**
 * Смена пароля студентом в «Профиле» (решение владельца 03.11.2026: «студент может сменить пароль»). Студент вводит текущий
 * пароль и новый дважды; правило нового пароля то же, что у восстановления (`checkStudentNewPassword`: не короче 12
 * символов, не длиннее 72 байт). Здесь только состояние формы, без сервера.
 */
export type StudentPasswordChangeStatus =
  | "idle"
  | "done"
  | "wrong_current"
  | "mismatch"
  | "too_short"
  | "too_long"
  | "same_password"
  | "rejected"
  | "rate_limited"
  | "sign_in_required"
  | "unavailable";

export type StudentPasswordChangeState = Readonly<{ status: StudentPasswordChangeStatus }>;

export const STUDENT_PASSWORD_CHANGE_INITIAL: StudentPasswordChangeState = { status: "idle" };

/** Ключ строки «Профиля» для каждого ответа; `idle` строки не имеет. */
export const STUDENT_PASSWORD_CHANGE_MESSAGE_KEY = {
  done: "passwordDone",
  wrong_current: "passwordWrongCurrent",
  mismatch: "passwordMismatch",
  too_short: "passwordTooShort",
  too_long: "passwordTooLong",
  same_password: "passwordSame",
  rejected: "passwordRejected",
  rate_limited: "passwordRateLimited",
  sign_in_required: "passwordSignInRequired",
  unavailable: "passwordUnavailable",
} as const satisfies Readonly<Record<Exclude<StudentPasswordChangeStatus, "idle">, string>>;
