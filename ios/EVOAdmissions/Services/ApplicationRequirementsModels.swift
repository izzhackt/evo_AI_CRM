import Foundation

/// B218 command input. Keep this value unchanged after an uncertain response;
/// dispatch/retry must never create a replacement request ID.
struct ApplicationRequirementsIntent: Encodable, Equatable, Sendable {
    let studentCaseId: UUID
    let applicationId: UUID
    let requestId: UUID

    init(studentCaseId: UUID, applicationId: UUID, requestId: UUID) throws {
        guard ApplicationRequirementsContract.validUUID(studentCaseId),
              ApplicationRequirementsContract.validUUID(applicationId),
              ApplicationRequirementsContract.validUUID(requestId) else {
            throw ApplicationRequirementsContractError.invalidIntent
        }
        self.studentCaseId = studentCaseId
        self.applicationId = applicationId
        self.requestId = requestId
    }

    private enum CodingKeys: String, CodingKey {
        case studentCaseId = "p_student_case_id"
        case applicationId = "p_application_id"
        case requestId = "p_request_id"
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(studentCaseId.uuidString.lowercased(), forKey: .studentCaseId)
        try values.encode(applicationId.uuidString.lowercased(), forKey: .applicationId)
        try values.encode(requestId.uuidString.lowercased(), forKey: .requestId)
    }
}

enum ApplicationRequirementsContractError: Error {
    case invalidIntent
    case mismatchedResponse
}

enum ApplicationRequirementKey: String, Decodable {
    case photo = "evo.photo.v1"
    case passport = "evo.passport.v1"
}

enum ApplicationRequirementsOrigin: String, Decodable {
    case evoStarter = "evo_starter"
}

enum ApplicationRequirementsConfiguration: String, Decodable {
    case needsConfirmation = "needs_confirmation"
}

enum ApplicationRequirementsState: String, Decodable {
    case uninitialized, initialized
    case needsConfiguration = "needs_configuration"
}

enum ApplicationRequirementsConfigurationReason: String, Decodable {
    case legacyCaseChecklist = "legacy_case_checklist"
    case legacyApplicationLinks = "legacy_application_links"
    case legacyApplicationConfiguration = "legacy_application_configuration"
    case ambiguousMaterial = "ambiguous_material"
    case materialAssociationUnavailable = "material_association_unavailable"
    case materialMetadataChanged = "material_metadata_changed"
}

enum ApplicationRequirementSlotStatus: String, Decodable {
    case required, submitted, approved, rejected
    case correctionRequired = "correction_required"
}

enum ApplicationRequirementReviewDecision: String, Decodable {
    case approved, rejected
    case correctionRequired = "correction_required"
}

enum ApplicationRequirementTechnicalAvailability: String, Decodable {
    case available, unavailable
}

enum ApplicationRequirementUnavailableReason: String, Decodable {
    case slotMissing = "slot_missing"
    case slotRemoved = "slot_removed"
    case applicationLinkMissing = "application_link_missing"
    case slotMetadataChanged = "slot_metadata_changed"
    case fileMissing = "file_missing"
    case uploadNotFinalized = "upload_not_finalized"
    case integrityPending = "integrity_pending"
    case integrityFailed = "integrity_failed"
    case malwarePending = "malware_pending"
    case malwareInfected = "malware_infected"
    case malwareError = "malware_error"

    fileprivate var isAssociationReason: Bool {
        switch self {
        case .slotMissing, .slotRemoved, .applicationLinkMissing, .slotMetadataChanged: return true
        default: return false
        }
    }
}

/// Immutable revision metadata, shared by the command receipt and reader.
/// needs_confirmation describes checklist completeness, not a new approval gate.
struct ApplicationRequirementsRevision: Decodable {
    let revisionId: UUID
    let revisionVersion: String
    let origin: ApplicationRequirementsOrigin
    let configurationState: ApplicationRequirementsConfiguration
    let initializedAt: String

    private enum CodingKeys: String, CodingKey {
        case revisionId, revisionVersion, origin, configurationState, initializedAt
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        revisionId = try values.decodeApplicationRequirementsUUID(forKey: .revisionId)
        revisionVersion = try values.decode(String.self, forKey: .revisionVersion)
        origin = try values.decode(ApplicationRequirementsOrigin.self, forKey: .origin)
        configurationState = try values.decode(ApplicationRequirementsConfiguration.self, forKey: .configurationState)
        initializedAt = try values.decode(String.self, forKey: .initializedAt)
        guard ApplicationRequirementsContract.validVersion(revisionVersion),
              ApplicationRequirementsContract.validTimestamp(initializedAt) else {
            throw ApplicationRequirementsContract.corrupted(decoder, "Invalid requirement revision.")
        }
    }
}

struct ApplicationRequirementsReceiptItem: Decodable {
    let requirementItemId: UUID
    let requirementKey: ApplicationRequirementKey
    let documentSlotId: UUID

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case requirementItemId, requirementKey, documentSlotId
    }

    init(from decoder: Decoder) throws {
        try ApplicationRequirementsContract.requireKeys(Set(CodingKeys.allCases.map(\.rawValue)), from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        requirementItemId = try values.decodeApplicationRequirementsUUID(forKey: .requirementItemId)
        requirementKey = try values.decode(ApplicationRequirementKey.self, forKey: .requirementKey)
        documentSlotId = try values.decodeApplicationRequirementsUUID(forKey: .documentSlotId)
    }
}

/// Exact replay returns this original result. It does not assert that a slot,
/// association or file is still available; read the current view separately.
struct ApplicationRequirementsReceipt: Decodable {
    let requestId: UUID
    let studentCaseId: UUID
    let applicationId: UUID
    let revision: ApplicationRequirementsRevision
    let items: [ApplicationRequirementsReceiptItem]

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case requestId, studentCaseId, applicationId, revisionId, revisionVersion
        case origin, configurationState, initializedAt, items
    }

    init(from decoder: Decoder) throws {
        try ApplicationRequirementsContract.requireKeys(Set(CodingKeys.allCases.map(\.rawValue)), from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        requestId = try values.decodeApplicationRequirementsUUID(forKey: .requestId)
        studentCaseId = try values.decodeApplicationRequirementsUUID(forKey: .studentCaseId)
        applicationId = try values.decodeApplicationRequirementsUUID(forKey: .applicationId)
        revision = try ApplicationRequirementsRevision(from: decoder)
        items = try values.decode([ApplicationRequirementsReceiptItem].self, forKey: .items)
        guard ApplicationRequirementsContract.validStarterItems(items.map {
            ($0.requirementItemId, $0.requirementKey, $0.documentSlotId)
        }) else {
            throw ApplicationRequirementsContract.corrupted(decoder, "Invalid starter requirement identities or order.")
        }
    }

    func validate(for intent: ApplicationRequirementsIntent) throws {
        guard requestId == intent.requestId, studentCaseId == intent.studentCaseId,
              applicationId == intent.applicationId else {
            throw ApplicationRequirementsContractError.mismatchedResponse
        }
    }
}

/// Requiredness, workflow/review and technical file availability are independent
/// axes. In particular, a rejected file can still be technically available.
struct ApplicationRequirementItem: Decodable, Identifiable {
    let requirementItemId: UUID
    let requirementKey: ApplicationRequirementKey
    let documentSlotId: UUID
    let position: Int
    let required: Bool
    let label: String
    let groupLabel: String
    let instructions: String
    let compatibilityKey: ApplicationRequirementKey
    let slotStatus: ApplicationRequirementSlotStatus?
    let currentVersionId: UUID?
    let currentVersionNo: String?
    let reviewDecision: ApplicationRequirementReviewDecision?
    let reviewReason: String?
    let reviewedAt: String?
    let technicalAvailability: ApplicationRequirementTechnicalAvailability
    let unavailableReasons: [ApplicationRequirementUnavailableReason]

    var id: UUID { requirementItemId }

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case requirementItemId, requirementKey, documentSlotId, position, required
        case label, groupLabel, instructions, compatibilityKey, slotStatus
        case currentVersionId, currentVersionNo, reviewDecision, reviewReason, reviewedAt
        case technicalAvailability, unavailableReasons
    }

    init(from decoder: Decoder) throws {
        try ApplicationRequirementsContract.requireKeys(Set(CodingKeys.allCases.map(\.rawValue)), from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        requirementItemId = try values.decodeApplicationRequirementsUUID(forKey: .requirementItemId)
        requirementKey = try values.decode(ApplicationRequirementKey.self, forKey: .requirementKey)
        documentSlotId = try values.decodeApplicationRequirementsUUID(forKey: .documentSlotId)
        position = try values.decode(Int.self, forKey: .position)
        required = try values.decode(Bool.self, forKey: .required)
        label = try values.decode(String.self, forKey: .label)
        groupLabel = try values.decode(String.self, forKey: .groupLabel)
        instructions = try values.decode(String.self, forKey: .instructions)
        compatibilityKey = try values.decode(ApplicationRequirementKey.self, forKey: .compatibilityKey)
        slotStatus = try values.decodeIfPresent(ApplicationRequirementSlotStatus.self, forKey: .slotStatus)
        currentVersionId = try values.decodeNil(forKey: .currentVersionId)
            ? nil : values.decodeApplicationRequirementsUUID(forKey: .currentVersionId)
        currentVersionNo = try values.decodeIfPresent(String.self, forKey: .currentVersionNo)
        reviewDecision = try values.decodeIfPresent(ApplicationRequirementReviewDecision.self, forKey: .reviewDecision)
        reviewReason = try values.decodeIfPresent(String.self, forKey: .reviewReason)
        reviewedAt = try values.decodeIfPresent(String.self, forKey: .reviewedAt)
        technicalAvailability = try values.decode(ApplicationRequirementTechnicalAvailability.self, forKey: .technicalAvailability)
        unavailableReasons = try values.decode([ApplicationRequirementUnavailableReason].self, forKey: .unavailableReasons)

        guard required, compatibilityKey == requirementKey,
              position == (requirementKey == .photo ? 1 : 2),
              [label, groupLabel, instructions].allSatisfy(ApplicationRequirementsContract.nonempty),
              (currentVersionId == nil) == (currentVersionNo == nil),
              currentVersionNo.map(ApplicationRequirementsContract.validVersion) ?? true,
              (reviewDecision == nil) == (reviewedAt == nil),
              reviewedAt.map(ApplicationRequirementsContract.validTimestamp) ?? true,
              reviewReason.map(ApplicationRequirementsContract.nonempty) ?? true,
              reviewReason == nil || reviewDecision == .correctionRequired || reviewDecision == .rejected,
              currentVersionId != nil || reviewDecision == nil,
              Set(unavailableReasons).count == unavailableReasons.count,
              unavailableReasons.filter({ [.integrityPending, .integrityFailed].contains($0) }).count <= 1,
              unavailableReasons.filter({ [.malwarePending, .malwareInfected, .malwareError].contains($0) }).count <= 1 else {
            throw ApplicationRequirementsContract.corrupted(decoder, "Invalid application requirement item.")
        }

        let associationReasons = unavailableReasons.filter(\.isAssociationReason)
        if !associationReasons.isEmpty {
            guard associationReasons.count == unavailableReasons.count,
                  technicalAvailability == .unavailable, slotStatus == nil,
                  currentVersionId == nil, reviewDecision == nil else {
                throw ApplicationRequirementsContract.corrupted(decoder, "Unavailable association exposes document state.")
            }
        } else {
            guard slotStatus != nil else {
                throw ApplicationRequirementsContract.corrupted(decoder, "Missing slot state without an association reason.")
            }
            switch technicalAvailability {
            case .available:
                guard currentVersionId != nil, unavailableReasons.isEmpty else {
                    throw ApplicationRequirementsContract.corrupted(decoder, "Available file has unavailable evidence.")
                }
            case .unavailable:
                guard !unavailableReasons.isEmpty,
                      (currentVersionId == nil ? unavailableReasons == [.fileMissing] : !unavailableReasons.contains(.fileMissing)) else {
                    throw ApplicationRequirementsContract.corrupted(decoder, "Unavailable file has inconsistent version evidence.")
                }
            }
        }
    }
}

/// Shared Student/staff current reader. No revision is different from an empty
/// complete checklist, and this model contains no package readiness counter.
struct ApplicationRequirementsView: Decodable {
    let studentCaseId: UUID
    let applicationId: UUID
    let state: ApplicationRequirementsState
    let revision: ApplicationRequirementsRevision?
    let configurationReasons: [ApplicationRequirementsConfigurationReason]
    let items: [ApplicationRequirementItem]

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case studentCaseId, applicationId, state, revisionId, revisionVersion
        case origin, configurationState, initializedAt, configurationReasons, items
    }

    init(from decoder: Decoder) throws {
        try ApplicationRequirementsContract.requireKeys(Set(CodingKeys.allCases.map(\.rawValue)), from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        studentCaseId = try values.decodeApplicationRequirementsUUID(forKey: .studentCaseId)
        applicationId = try values.decodeApplicationRequirementsUUID(forKey: .applicationId)
        state = try values.decode(ApplicationRequirementsState.self, forKey: .state)
        configurationReasons = try values.decode([ApplicationRequirementsConfigurationReason].self, forKey: .configurationReasons)
        items = try values.decode([ApplicationRequirementItem].self, forKey: .items)
        guard Set(configurationReasons).count == configurationReasons.count else {
            throw ApplicationRequirementsContract.corrupted(decoder, "Duplicate requirements configuration reason.")
        }
        if try values.decodeNil(forKey: .revisionId) {
            for key: CodingKeys in [.revisionVersion, .origin, .configurationState, .initializedAt] {
                guard try values.decodeNil(forKey: key) else {
                    throw ApplicationRequirementsContract.corrupted(decoder, "Uninitialized requirements contain revision metadata.")
                }
            }
            revision = nil
            guard items.isEmpty,
                  (state == .uninitialized && configurationReasons.isEmpty)
                    || (state == .needsConfiguration && !configurationReasons.isEmpty) else {
                throw ApplicationRequirementsContract.corrupted(decoder, "Invalid requirements state without a revision.")
            }
        } else {
            revision = try ApplicationRequirementsRevision(from: decoder)
            guard ApplicationRequirementsContract.validStarterItems(items.map {
                ($0.requirementItemId, $0.requirementKey, $0.documentSlotId)
            }) else {
                throw ApplicationRequirementsContract.corrupted(decoder, "Invalid current starter identities or order.")
            }
            var expectedReasons = Set<ApplicationRequirementsConfigurationReason>()
            for item in items {
                for reason in item.unavailableReasons where reason.isAssociationReason {
                    expectedReasons.insert(reason == .slotMetadataChanged ? .materialMetadataChanged : .materialAssociationUnavailable)
                }
            }
            guard Set(configurationReasons) == expectedReasons,
                  state == (expectedReasons.isEmpty ? .initialized : .needsConfiguration) else {
                throw ApplicationRequirementsContract.corrupted(decoder, "Requirements configuration contradicts its item associations.")
            }
        }
    }

    func validate(studentCaseId: UUID, applicationId: UUID) throws {
        guard self.studentCaseId == studentCaseId, self.applicationId == applicationId else {
            throw ApplicationRequirementsContractError.mismatchedResponse
        }
    }
}

enum ApplicationRequirementsFailure: String, Error {
    case invalidIntent = "application_requirements_invalid_intent"
    case requestConflict = "application_requirements_request_conflict"
    case forbidden = "application_requirements_unavailable"
    case caseIneligible = "application_requirements_case_ineligible"
    case applicationIneligible = "application_requirements_application_ineligible"
    case needsConfiguration = "application_requirements_needs_configuration"
    case invariantConflict = "application_requirements_invariant_conflict"

    static func serverReason(code: String?, message: String) -> Self? {
        if code == "42501" { return .forbidden }
        guard let reason = Self(rawValue: message) else { return nil }
        switch reason {
        case .invalidIntent, .requestConflict: return code == "22023" ? reason : nil
        case .caseIneligible, .applicationIneligible, .needsConfiguration: return code == "PT409" ? reason : nil
        case .invariantConflict: return code == "55000" ? reason : nil
        case .forbidden: return nil
        }
    }
}

private enum ApplicationRequirementsContract {
    static func validUUID(_ value: UUID) -> Bool { validUUIDString(value.uuidString.lowercased()) }

    static func validUUIDString(_ value: String) -> Bool {
        matches(value, "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    }

    static func validVersion(_ value: String) -> Bool {
        value.utf8.count <= 19 && matches(value, "^[1-9][0-9]*$") && Int64(value).map { $0 > 0 } == true
    }

    static func validTimestamp(_ value: String) -> Bool {
        matches(value, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$")
            && PostgresTimestamp.date(from: value) != nil
    }

    static func nonempty(_ value: String) -> Bool { !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    static func validStarterItems(_ items: [(UUID, ApplicationRequirementKey, UUID)]) -> Bool {
        items.count == 2 && items.map { $0.1 } == [.photo, .passport]
            && Set(items.map { $0.0 }).count == 2 && Set(items.map { $0.2 }).count == 2
    }

    private static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) == value.startIndex..<value.endIndex
    }

    static func corrupted(_ decoder: Decoder, _ message: String) -> DecodingError {
        .dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: message))
    }

    private struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    static func requireKeys(_ expected: Set<String>, from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: Key.self)
        guard Set(values.allKeys.map(\.stringValue)) == expected else {
            throw corrupted(decoder, "Unexpected application requirements response fields.")
        }
    }
}

private extension KeyedDecodingContainer {
    func decodeApplicationRequirementsUUID(forKey key: Key) throws -> UUID {
        let raw = try decode(String.self, forKey: key)
        guard ApplicationRequirementsContract.validUUIDString(raw), let value = UUID(uuidString: raw) else {
            throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "Expected a canonical lowercase UUID.")
        }
        return value
    }
}
