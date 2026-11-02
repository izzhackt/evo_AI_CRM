#!/bin/sh
set -eu

usage() {
  echo "usage: backup-protected-volume.sh SOURCE_DIR DESTINATION_TAR STORE_NAME" >&2
  exit 64
}

[ "$#" -eq 3 ] || usage
source_dir=$1
destination=$2
store_name=$3

case "$source_dir" in
  /*) ;;
  *) echo "source must be absolute" >&2; exit 65 ;;
esac
case "$destination" in
  /|/tmp|/var/tmp|/opt/evo-crm|/opt/evo-crm/*|/opt/evo-inbox|/opt/evo-inbox/*|/var/lib/docker|/var/lib/docker/*)
    echo "destination is broad or production-owned" >&2
    exit 66
    ;;
  /*) ;;
  *) echo "destination must be absolute" >&2; exit 65 ;;
esac
[ -d "$source_dir" ] || { echo "source directory does not exist" >&2; exit 67; }

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
tar --numeric-owner --xattrs --acls -C "$source_dir" -cpf "$destination" .
chmod 600 "$destination"
archive_sha=$(sha256sum "$destination" | awk '{print $1}')
archive_bytes=$(wc -c < "$destination" | tr -d ' ')
file_count=$(tar -tf "$destination" | wc -l | tr -d ' ')
[ "$file_count" -gt 0 ] || { echo "archive verification found no entries" >&2; exit 68; }
duration=$(( $(date +%s) - started ))
manifest="${destination}.manifest"
{
  echo "format_version=1"
  echo "kind=evo-protected-volume-backup"
  echo "store=$store_name"
  echo "artifact=$(basename "$destination")"
  echo "bytes=$archive_bytes"
  echo "sha256=$archive_sha"
  echo "entries=$file_count"
  echo "archive_list_verified=true"
  echo "duration_seconds=$duration"
} > "$manifest"
chmod 600 "$manifest"
printf '{"status":"verified","store":"%s","bytes":%s,"entries":%s,"durationSeconds":%s}\n' \
  "$store_name" "$archive_bytes" "$file_count" "$duration"
