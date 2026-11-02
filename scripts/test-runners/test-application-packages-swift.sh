#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
package_check_dir="$(mktemp -d "${TMPDIR:-/tmp}/evo-package-swift.XXXXXX")"
trap 'rm -rf "$package_check_dir"' EXIT
xcrun swiftc \
  ios/EVOAdmissions/Services/PostgresTimestamp.swift \
  ios/EVOAdmissions/Services/ApplicationRequirementsModels.swift \
  ios/EVOAdmissions/Services/ApplicationRequirementsV2Models.swift \
  ios/EVOAdmissions/Services/PortalDocumentTransfer.swift \
  ios/EVOAdmissions/Services/ApplicationDocumentUpload.swift \
  ios/EVOAdmissions/Services/ApplicationDocumentModels.swift \
  ios/EVOAdmissions/Services/ApplicationPackageModels.swift \
  ios/EVOAdmissions/Services/ApplicationPackagePending.swift \
  tests/swift/application-packages-codec.swift \
  -o "$package_check_dir/application-packages-codec"
"$package_check_dir/application-packages-codec" "$@"
