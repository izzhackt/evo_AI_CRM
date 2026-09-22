#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
package_selection_dir="$(mktemp -d "${TMPDIR:-/tmp}/evo-package-selection.XXXXXX")"
trap 'rm -rf "$package_selection_dir"' EXIT
xcrun swiftc \
  ios/EVOAdmissions/Services/PostgresTimestamp.swift \
  ios/EVOAdmissions/Services/ApplicationRequirementsModels.swift \
  ios/EVOAdmissions/Services/ApplicationRequirementsV2Models.swift \
  ios/EVOAdmissions/Services/PortalDocumentTransfer.swift \
  ios/EVOAdmissions/Services/ApplicationDocumentUpload.swift \
  ios/EVOAdmissions/Services/ApplicationDocumentModels.swift \
  ios/EVOAdmissions/Services/ApplicationPackageModels.swift \
  ios/EVOAdmissions/Services/ProgramPackageSelectionState.swift \
  ios/EVOAdmissions/Services/AdmissionModels.swift \
  tests/swift/application-package-selection.swift \
  -o "$package_selection_dir/application-package-selection"
"$package_selection_dir/application-package-selection"
