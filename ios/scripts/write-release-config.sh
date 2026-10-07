#!/bin/sh
# Пишет ios/Release.xcconfig для конфигурации Release (архив для App Store)
# из переменных окружения. Файл в .gitignore и не попадает в Git.
#
#   SUPABASE_URL=https://iosckaqtovbbnssqcpde.supabase.co \
#   SUPABASE_PUBLISHABLE_KEY=... \
#   DEVELOPMENT_TEAM=... \
#   ios/scripts/write-release-config.sh
#
# SUPABASE_URL              обязательно, только https://, без пути.
# SUPABASE_PUBLISHABLE_KEY  обязательно, публичный клиентский ключ (publishable
#                           или anon), не service_role.
# DEVELOPMENT_TEAM          Team ID Apple, 10 символов A-Z и 0-9. Можно не
#                           задавать для сборки под симулятор; архив без него
#                           остановит scripts/check-release-config.sh.
# PORTAL_WEB_BASE_URL       необязательно, по умолчанию
#                           https://app.evoadmissions.com, только https://.
# RELEASE_XCCONFIG_PATH     необязательно, куда писать; по умолчанию
#                           ios/Release.xcconfig рядом с project.yml.
#
# Ключ в вывод не печатается. Адреса с http:// отклоняются: в Release нет
# исключений ATS, такой адрес всё равно не откроется.
set -eu

fail() {
  echo "write-release-config: $*" >&2
  exit 1
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ios_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
output=${RELEASE_XCCONFIG_PATH:-"$ios_dir/Release.xcconfig"}

supabase_url=${SUPABASE_URL:-}
publishable_key=${SUPABASE_PUBLISHABLE_KEY:-}
team_id=${DEVELOPMENT_TEAM:-}
portal_url=${PORTAL_WEB_BASE_URL:-https://app.evoadmissions.com}

# Проверяет адрес: только https://, хост из букв, цифр, точек и дефисов,
# необязательный порт, без пути, запроса и пробелов. Печатает адрес без
# завершающего «/».
https_origin() {
  name=$1
  value=$2
  [ -n "$value" ] || fail "$name не задан."
  case $value in
    http://*) fail "$name использует http://. В Release разрешён только https://." ;;
    https://*) ;;
    *) fail "$name должен начинаться с https://." ;;
  esac
  trimmed=${value%/}
  printf '%s\n' "$trimmed" | grep -Eq '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$' \
    || fail "$name должен быть адресом вида https://host без пути и пробелов."
  printf '%s\n' "$trimmed"
}

supabase_url=$(https_origin SUPABASE_URL "$supabase_url")
portal_url=$(https_origin PORTAL_WEB_BASE_URL "$portal_url")

[ -n "$publishable_key" ] || fail "SUPABASE_PUBLISHABLE_KEY не задан."
printf '%s\n' "$publishable_key" | grep -Eq '^[A-Za-z0-9._-]+$' \
  || fail "SUPABASE_PUBLISHABLE_KEY содержит недопустимые символы."
case $publishable_key in
  sb_secret_*) fail "SUPABASE_PUBLISHABLE_KEY похож на секретный ключ sb_secret_. Нужен publishable." ;;
esac

if [ -n "$team_id" ]; then
  printf '%s\n' "$team_id" | grep -Eq '^[A-Z0-9]{10}$' \
    || fail "DEVELOPMENT_TEAM должен состоять из 10 символов A-Z и 0-9."
fi

# xcconfig считает «//» началом комментария в любом месте строки:
# https://host записывается как https:/$()/host.
xcconfig_url() {
  printf '%s\n' "$1" | sed 's#^https://#https:/$()/#'
}

umask 077
tmp=$(mktemp "${output}.XXXXXX")
trap 'rm -f "$tmp"' EXIT
{
  echo "// Создан ios/scripts/write-release-config.sh. Не коммитить."
  echo "// Публичные клиентские значения для Release; секретов здесь нет."
  echo "SUPABASE_URL = $(xcconfig_url "$supabase_url")"
  echo "SUPABASE_PUBLISHABLE_KEY = $publishable_key"
  echo "PORTAL_WEB_BASE_URL = $(xcconfig_url "$portal_url")"
  echo "DEVELOPMENT_TEAM = $team_id"
} > "$tmp"
mv "$tmp" "$output"
trap - EXIT

echo "write-release-config: записан $output"
echo "  SUPABASE_URL = $supabase_url"
echo "  SUPABASE_PUBLISHABLE_KEY задан, длина ${#publishable_key}"
echo "  PORTAL_WEB_BASE_URL = $portal_url"
if [ -n "$team_id" ]; then
  echo "  DEVELOPMENT_TEAM задан"
else
  echo "  DEVELOPMENT_TEAM пуст: сборка под симулятор пройдёт, архив будет остановлен."
fi
