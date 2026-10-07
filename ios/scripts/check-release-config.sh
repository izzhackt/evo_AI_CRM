#!/bin/sh
# Шаг сборки цели «EVO admissions» (preBuildScripts в project.yml).
# В Debug ничего не делает. В Release останавливает сборку, если:
#   - нет значений из ios/Release.xcconfig (его пишет write-release-config.sh);
#   - SUPABASE_URL или PORTAL_WEB_BASE_URL не https://;
#   - SUPABASE_PUBLISHABLE_KEY секретный (sb_secret_ или JWT service_role);
#   - в Info.plist есть NSAppTransportSecurity (исключение ATS только для
#     локального стенда и только в Debug, в выпуск оно не попадает).
# При архиве (ACTION=install) дополнительно требует настоящий ключ без
# заглушки и Team ID из 10 символов.
# Строки с «error:» Xcode показывает как ошибки сборки.
set -eu

[ "${CONFIGURATION:-}" = "Release" ] || exit 0

fail() {
  echo "error: $*" >&2
  exit 1
}

hint="Запишите ios/Release.xcconfig командой ios/scripts/write-release-config.sh (см. ios/README.md, «Выпуск в App Store»)."

https_value() {
  name=$1
  value=$2
  [ -n "$value" ] || fail "$name пуст в Release. $hint"
  case $value in
    https://?*) ;;
    *) fail "$name в Release должен начинаться с https://. $hint" ;;
  esac
}

# Секретный ключ обходит RLS и не должен попасть в архив: отклоняются
# sb_secret_… и старый JWT с "role":"service_role" в полезной нагрузке.
reject_secret_key() {
  case $1 in
    sb_secret_*) fail "SUPABASE_PUBLISHABLE_KEY это секретный ключ sb_secret_. Нужен publishable. $hint" ;;
    eyJ*.*.*)
      payload=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+')
      case $(( ${#payload} % 4 )) in 2) payload="$payload==" ;; 3) payload="$payload=" ;; esac
      if printf '%s' "$payload" | base64 -D 2>/dev/null | tr -d ' ' | grep -q '"role":"service_role"'; then
        fail "SUPABASE_PUBLISHABLE_KEY это ключ service_role. Нужен publishable или anon. $hint"
      fi ;;
  esac
}

https_value SUPABASE_URL "${SUPABASE_URL:-}"
[ -n "${SUPABASE_PUBLISHABLE_KEY:-}" ] || fail "SUPABASE_PUBLISHABLE_KEY пуст в Release. $hint"
reject_secret_key "$SUPABASE_PUBLISHABLE_KEY"
https_value PORTAL_WEB_BASE_URL "${PORTAL_WEB_BASE_URL:-}"

if [ -n "${DEVELOPMENT_TEAM:-}" ]; then
  printf '%s\n' "$DEVELOPMENT_TEAM" | grep -Eq '^[A-Z0-9]{10}$' \
    || fail "DEVELOPMENT_TEAM в Release не похож на Team ID (10 символов A-Z и 0-9). $hint"
fi

plist="${SRCROOT:?}/${INFOPLIST_FILE:?}"
[ -f "$plist" ] || fail "Не найден $plist."
if /usr/libexec/PlistBuddy -c "Print :NSAppTransportSecurity" "$plist" >/dev/null 2>&1; then
  fail "В $INFOPLIST_FILE есть NSAppTransportSecurity. Исключение ATS для локального стенда не должно попасть в выпуск: уберите его, версия файла в Git его не содержит."
fi

if [ "${ACTION:-}" = "install" ]; then
  case $SUPABASE_PUBLISHABLE_KEY in
    *REPLACE*|*PLACEHOLDER*|*placeholder*|your-*)
      fail "SUPABASE_PUBLISHABLE_KEY в архиве содержит заглушку. $hint" ;;
  esac
  [ -n "${DEVELOPMENT_TEAM:-}" ] || fail "DEVELOPMENT_TEAM пуст: архив для App Store нельзя подписать. $hint"
fi

echo "check-release-config: Release настроен (${SUPABASE_URL}, ${PORTAL_WEB_BASE_URL})."
