// Логи, которые CI выкладывает в публичный артефакт, не должны содержать ключей: даже локальные ключи Supabase
// по умолчанию вычёркиваются (JWT, sb_secret_/sb_publishable_, пароль в строке подключения Postgres).
export function redact(text) {
  return String(text)
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/gu, "[redacted-jwt]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/gu, "[redacted-sb-key]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gu, "$1[redacted]@");
}
