#!/bin/sh
set -eu

usage() {
  echo "usage: backup-release-config.sh DESTINATION_TAR STORE_NAME SOURCE_FILE..." >&2
  exit 64
}

[ "$#" -ge 3 ] || usage
destination=$1
store_name=$2
shift 2

case "$destination" in
  /|/tmp|/var/tmp|/opt/evo-crm|/opt/evo-crm/*|/opt/evo-inbox|/opt/evo-inbox/*|/var/lib/docker|/var/lib/docker/*)
    echo "destination is broad or production-owned" >&2
    exit 66
    ;;
  /*) ;;
  *) echo "destination must be absolute" >&2; exit 65 ;;
esac

for source_file in "$@"; do
  case "$source_file" in
    /opt/evo-crm/*|/opt/evo-inbox/*|/opt/evo-releases/*) ;;
    *) echo "configuration source is outside an approved EVO root" >&2; exit 67 ;;
  esac
  [ -f "$source_file" ] || { echo "required configuration source is missing" >&2; exit 68; }
done

dir_mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
dir_uid() { stat -c %u "$1" 2>/dev/null || stat -f %u "$1"; }

destination_dir=$(dirname "$destination")
case "$destination_dir" in /tmp|/var/tmp) echo "destination requires a dedicated private directory" >&2; exit 66;; esac
if [ -e "$destination_dir" ]; then
  [ -d "$destination_dir" ] || { echo "destination directory is not a directory" >&2; exit 69; }
  [ "$(dir_mode "$destination_dir")" = 700 ] || { echo "existing destination directory must be mode 0700" >&2; exit 69; }
  [ "$(dir_uid "$destination_dir")" = "$(id -u)" ] || { echo "existing destination directory must be owned by the current user" >&2; exit 69; }
else
  destination_parent=$(dirname "$destination_dir")
  [ -d "$destination_parent" ] || { echo "destination parent must already exist" >&2; exit 69; }
  [ "$(dir_mode "$destination_parent")" = 700 ] || { echo "destination parent must be mode 0700" >&2; exit 69; }
  [ "$(dir_uid "$destination_parent")" = "$(id -u)" ] || { echo "destination parent must be owned by the current user" >&2; exit 69; }
  mkdir -m 700 "$destination_dir"
fi
umask 077

started=$(date +%s)
tar --numeric-owner --xattrs --acls -P -cpf "$destination" "$@" 2>/dev/null
chmod 600 "$destination"
archive_sha=$(sha256sum "$destination" | awk '{print $1}')
archive_bytes=$(wc -c < "$destination" | tr -d ' ')
file_count=$(tar -tf "$destination" 2>/dev/null | wc -l | tr -d ' ')
[ "$file_count" -eq "$#" ] || { echo "configuration archive is incomplete" >&2; exit 69; }
duration=$(( $(date +%s) - started ))
manifest="${destination}.manifest"
{
  echo "format_version=1"
  echo "kind=evo-release-config-backup"
  echo "store=$store_name"
  echo "artifact=$(basename "$destination")"
  echo "bytes=$archive_bytes"
  echo "sha256=$archive_sha"
  echo "files=$file_count"
  echo "archive_list_verified=true"
  echo "duration_seconds=$duration"
} > "$manifest"
chmod 600 "$manifest"
printf '{"status":"verified","store":"%s","bytes":%s,"files":%s,"durationSeconds":%s}\n' \
  "$store_name" "$archive_bytes" "$file_count" "$duration"
