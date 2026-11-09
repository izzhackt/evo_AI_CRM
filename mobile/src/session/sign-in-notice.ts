// Одноразовое пояснение на экране входа: почему приложение вернуло человека ко входу
// (например, сессия не продлилась после смены пароля). Живёт в памяти, на диск не попадает.
let pending: "session_expired" | null = null;

export function setSignInNotice(notice: "session_expired"): void {
  pending = notice;
}

export function takeSignInNotice(): "session_expired" | null {
  const value = pending;
  pending = null;
  return value;
}
