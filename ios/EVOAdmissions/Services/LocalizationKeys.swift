import Foundation

/// Ключи каталога строк для значений, пришедших с сервера.
///
/// Литерал с интерполяцией внутри `LocalizedStringKey("prep_status_\(x)")`
/// SwiftUI превращает в ключ формата `prep_status_%@`. Такого ключа в каталоге
/// нет, и на экране оставался сырой ключ (`prep_status_preparation`, аудит
/// UX/UI 2026-10, L10N-01). Здесь каждый ключ записан явным `switch`: новый
/// статус не соберётся, пока для него не выбран ключ, а `LocalizationKeysTests`
/// сверяет каждый ключ с каталогом RU и KY. Во view ключ передаётся через
/// `LocalizedStringKey(String)`, который берёт строку как готовый ключ.
extension CatalogPreparationApplicationStatus {
    var labelKey: String {
        switch self {
        case .preparation: return "prep_status_preparation"
        case .ready: return "prep_status_ready"
        case .submitted: return "prep_status_submitted"
        case .underReview: return "prep_status_under_review"
        case .offer: return "prep_status_offer"
        case .rejected: return "prep_status_rejected"
        case .enrolled: return "prep_status_enrolled"
        case .withdrawn: return "prep_status_withdrawn"
        case .closed: return "prep_status_closed"
        }
    }
}

extension ApplicationPackageReadyReason {
    var labelKey: String {
        switch self {
        case .requirementsUnavailable: return "package_reason_requirements_unavailable"
        case .emptyComposition: return "package_reason_empty_composition"
        case .missingRequired: return "package_reason_missing_required"
        case .materialUnavailable: return "package_reason_material_unavailable"
        case .fileUnavailable: return "package_reason_file_unavailable"
        case .previousSubmissionChanged: return "package_reason_previous_submission_changed"
        }
    }
}

extension ApplicationPackageDecision {
    var labelKey: String {
        switch self {
        case .approved: return "package_decision_approved"
        case .correctionRequired: return "package_decision_correction_required"
        }
    }
}

extension ApplicationRequirementReviewDecision {
    var labelKey: String {
        switch self {
        case .approved: return "prep_review_approved"
        case .rejected: return "prep_review_rejected"
        case .correctionRequired: return "prep_review_correction_required"
        }
    }
}

extension ApplicationRequirementUnavailableReason {
    var labelKey: String {
        switch self {
        case .slotMissing: return "prep_file_slot_missing"
        case .slotRemoved: return "prep_file_slot_removed"
        case .applicationLinkMissing: return "prep_file_application_link_missing"
        case .slotMetadataChanged: return "prep_file_slot_metadata_changed"
        case .fileMissing: return "prep_file_file_missing"
        case .uploadNotFinalized: return "prep_file_upload_not_finalized"
        case .integrityPending: return "prep_file_integrity_pending"
        case .integrityFailed: return "prep_file_integrity_failed"
        case .malwarePending: return "prep_file_malware_pending"
        case .malwareInfected: return "prep_file_malware_infected"
        case .malwareError: return "prep_file_malware_error"
        }
    }
}

extension ApplicationDocumentUnavailableReason {
    var labelKey: String {
        switch self {
        case .fileMissing: return "prep_file_file_missing"
        case .uploadNotFinalized: return "prep_file_upload_not_finalized"
        case .integrityPending: return "prep_file_integrity_pending"
        case .integrityFailed: return "prep_file_integrity_failed"
        case .malwarePending: return "prep_file_malware_pending"
        case .malwareInfected: return "prep_file_malware_infected"
        case .malwareError: return "prep_file_malware_error"
        case .storageObjectUnavailable: return "prep_file_storage_object_unavailable"
        case .scanProofUnavailable: return "prep_file_scan_proof_unavailable"
        }
    }
}

extension StudentApplication.Status {
    var titleKey: String {
        switch self {
        case .pending: return "apply_status_pending_title"
        case .approved: return "apply_status_approved_title"
        case .rejected: return "apply_status_rejected_title"
        }
    }
}
