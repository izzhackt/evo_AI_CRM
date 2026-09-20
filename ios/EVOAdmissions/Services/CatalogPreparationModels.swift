import Foundation

/// Frozen input for `student_select_catalog_intake_v1` (214). Create this once
/// per user intent and retain it for an uncertain response/retry. Dispatch does
/// not mint IDs, refresh the chosen publication or infer authority from the UI.
struct CatalogPreparationIntent: Encodable, Equatable, Sendable {
    let studentCaseId: UUID
    let institutionId: UUID
    let programId: String
    let intakeId: String
    let publicationVersion: Int64
    let requestId: UUID

    init(
        studentCaseId: UUID,
        institutionId: UUID,
        programId: String,
        intakeId: String,
        publicationVersion: Int64,
        requestId: UUID
    ) throws {
        guard CatalogPreparationContract.validUUID(studentCaseId),
              CatalogPreparationContract.validUUID(institutionId),
              CatalogPreparationContract.validUUID(requestId),
              CatalogPreparationContract.validProgramID(programId),
              CatalogPreparationContract.validIntakeID(intakeId),
              CatalogPreparationContract.validPublicationVersion(publicationVersion) else {
            throw CatalogPreparationContractError.invalidIntent
        }
        self.studentCaseId = studentCaseId
        self.institutionId = institutionId
        self.programId = programId
        self.intakeId = intakeId
        self.publicationVersion = publicationVersion
        self.requestId = requestId
    }

    enum CodingKeys: String, CodingKey {
        case studentCaseId = "p_student_case_id"
        case institutionId = "p_catalog_institution_id"
        case programId = "p_program_id"
        case intakeId = "p_intake_id"
        case publicationVersion = "p_publication_version"
        case requestId = "p_request_id"
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(studentCaseId.uuidString.lowercased(), forKey: .studentCaseId)
        try values.encode(institutionId.uuidString.lowercased(), forKey: .institutionId)
        try values.encode(programId, forKey: .programId)
        try values.encode(intakeId, forKey: .intakeId)
        try values.encode(publicationVersion, forKey: .publicationVersion)
        try values.encode(requestId.uuidString.lowercased(), forKey: .requestId)
    }
}

enum CatalogPreparationContractError: Error {
    case invalidIntent
    case mismatchedResponse
}

/// Server decision at selection time, never a client-side deadline calculation
/// or a statement about whether this intake is eligible today.
enum CatalogPreparationDeadlineState: String, Decodable {
    case confirmed
    case needsConfirmation = "needs_confirmation"
}

/// Immutable binding metadata shared by the command receipt and current reader.
/// The original publication remains pinned even when a later request names a
/// newer publication for the same already-selected program/intake.
struct CatalogPreparationSelection: Decodable {
    let applicationId: UUID
    let studentCaseId: UUID
    let institutionId: UUID
    let programId: String
    let intakeId: String
    let publicationId: UUID
    let publicationVersion: Int64
    let catalogLevel: String
    let applicationDegree: String
    let selectedAt: String
    let deadlineStateAtSelection: CatalogPreparationDeadlineState

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case applicationId, studentCaseId, institutionId, programId, intakeId
        case publicationId, publicationVersion, catalogLevel, applicationDegree
        case selectedAt, deadlineStateAtSelection
    }

    fileprivate static let keys = Set(CodingKeys.allCases.map(\.rawValue))

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        applicationId = try values.decodeCatalogPreparationUUID(forKey: .applicationId)
        studentCaseId = try values.decodeCatalogPreparationUUID(forKey: .studentCaseId)
        institutionId = try values.decodeCatalogPreparationUUID(forKey: .institutionId)
        programId = try values.decode(String.self, forKey: .programId)
        intakeId = try values.decode(String.self, forKey: .intakeId)
        publicationId = try values.decodeCatalogPreparationUUID(forKey: .publicationId)
        publicationVersion = try values.decode(Int64.self, forKey: .publicationVersion)
        catalogLevel = try values.decode(String.self, forKey: .catalogLevel)
        applicationDegree = try values.decode(String.self, forKey: .applicationDegree)
        selectedAt = try values.decode(String.self, forKey: .selectedAt)
        deadlineStateAtSelection = try values.decode(CatalogPreparationDeadlineState.self, forKey: .deadlineStateAtSelection)
        guard CatalogPreparationContract.validProgramID(programId),
              CatalogPreparationContract.validIntakeID(intakeId),
              CatalogPreparationContract.validPublicationVersion(publicationVersion),
              UniversityCatalogFilterPolicy.levels.contains(catalogLevel),
              applicationDegree == (catalogLevel == "doctorate" ? "phd" : catalogLevel),
              CatalogPreparationContract.validTimestamp(selectedAt) else {
            throw CatalogPreparationContract.corrupted(decoder, "Invalid catalog preparation binding.")
        }
    }

    fileprivate var identity: String {
        "\(studentCaseId)/\(institutionId)/\(programId)/\(intakeId)"
    }
}

/// Immutable command result. Deliberately has no applicationStatus/version:
/// replaying this receipt must not overwrite a newer status from the reader.
struct CatalogPreparationReceipt: Decodable {
    let requestId: UUID
    let selection: CatalogPreparationSelection

    private enum CodingKeys: String, CodingKey { case requestId }

    init(from decoder: Decoder) throws {
        try CatalogPreparationContract.requireKeys(
            CatalogPreparationSelection.keys.union(["requestId"]), from: decoder
        )
        let values = try decoder.container(keyedBy: CodingKeys.self)
        requestId = try values.decodeCatalogPreparationUUID(forKey: .requestId)
        selection = try CatalogPreparationSelection(from: decoder)
    }

    func validate(for intent: CatalogPreparationIntent) throws {
        guard requestId == intent.requestId,
              selection.studentCaseId == intent.studentCaseId,
              selection.institutionId == intent.institutionId,
              selection.programId == intent.programId,
              selection.intakeId == intent.intakeId else {
            throw CatalogPreparationContractError.mismatchedResponse
        }
        // Do not compare publicationVersion: an existing binding retains the
        // original snapshot rather than silently replacing it with this intent.
    }
}

/// Existing `platform.application_status` values, shared with the staff/web
/// contract in src/lib/platform-application-contract.ts.
enum CatalogPreparationApplicationStatus: String, Decodable {
    case preparation, ready, submitted
    case underReview = "under_review"
    case offer, rejected, enrolled, withdrawn, closed
}

/// A current reader row plus the original selected publication. This is not a
/// command receipt and cannot be used to claim document requirements are ready.
struct CatalogPreparation: Decodable, Identifiable {
    let selection: CatalogPreparationSelection
    let applicationStatus: CatalogPreparationApplicationStatus
    let applicationVersion: String
    let content: UniversityContent

    var id: UUID { selection.applicationId }

    private enum CodingKeys: String, CodingKey {
        case applicationStatus, applicationVersion, content
    }

    init(from decoder: Decoder) throws {
        try CatalogPreparationContract.requireKeys(
            CatalogPreparationSelection.keys.union(["applicationStatus", "applicationVersion", "content"]),
            from: decoder
        )
        selection = try CatalogPreparationSelection(from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        applicationStatus = try values.decode(CatalogPreparationApplicationStatus.self, forKey: .applicationStatus)
        applicationVersion = try values.decode(String.self, forKey: .applicationVersion)
        content = try values.decode(UniversityContent.self, forKey: .content)
        let programs = content.programs.filter { $0.id == selection.programId }
        guard CatalogPreparationContract.validApplicationVersion(applicationVersion),
              CatalogPreparationContract.countries.contains(content.country),
              programs.count == 1,
              programs[0].level == selection.catalogLevel,
              programs[0].intakes.filter({ $0.id == selection.intakeId }).count == 1 else {
            throw CatalogPreparationContract.corrupted(decoder, "Preparation does not match its selected publication.")
        }
    }
}

/// The reader wire shape is a JSON array. Reject duplicated application or
/// stable selection identities instead of silently dropping/overwriting rows.
struct CatalogPreparationList: Decodable {
    let items: [CatalogPreparation]

    init(from decoder: Decoder) throws {
        items = try decoder.singleValueContainer().decode([CatalogPreparation].self)
        guard Set(items.map(\.id)).count == items.count,
              Set(items.map { $0.selection.identity }).count == items.count else {
            throw CatalogPreparationContract.corrupted(decoder, "Duplicate catalog preparation.")
        }
    }

    func validate(studentCaseId: UUID) throws {
        guard items.allSatisfy({ $0.selection.studentCaseId == studentCaseId }) else {
            throw CatalogPreparationContractError.mismatchedResponse
        }
    }
}

/// Stable, authenticated server reasons only; neither dates nor display status
/// are used to reproduce eligibility locally. Unknown errors still throw.
enum CatalogPreparationFailure: String, Error {
    case invalidIntent = "catalog_preparation_invalid_intent"
    case requestConflict = "catalog_preparation_request_conflict"
    case caseIneligible = "catalog_preparation_case_ineligible"
    case stalePublication = "catalog_preparation_stale_publication"
    case programUnavailable = "catalog_preparation_program_unavailable"
    case intakeUnavailable = "catalog_preparation_intake_unavailable"
    case intakeIdentityRequired = "catalog_preparation_intake_identity_required"
    case unsupportedCountry = "catalog_preparation_unsupported_country"
    case intakeClosed = "catalog_preparation_intake_closed"
    case intakeExpired = "catalog_preparation_intake_expired"
    case forbidden = "catalog_preparation_unavailable"

    static func serverReason(code: String?, message: String) -> Self? {
        if code == "42501" { return .forbidden }
        guard let reason = Self(rawValue: message) else { return nil }
        switch reason {
        case .invalidIntent, .requestConflict:
            return code == "22023" ? reason : nil
        case .forbidden:
            return nil
        default:
            return code == "PT409" ? reason : nil
        }
    }
}

private enum CatalogPreparationContract {
    static let countries: Set<String> = ["CN", "MY", "AE", "TR", "IT", "CZ"]

    static func validUUID(_ value: UUID) -> Bool {
        validIntakeID(value.uuidString.lowercased())
    }

    static func validProgramID(_ value: String) -> Bool {
        value.count <= 64 && matches(value, "^[a-z0-9][a-z0-9-]*$")
    }

    static func validIntakeID(_ value: String) -> Bool {
        matches(value, "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    }

    static func validPublicationVersion(_ value: Int64) -> Bool {
        value > 0 && value <= 9_007_199_254_740_990
    }

    static func validApplicationVersion(_ value: String) -> Bool {
        matches(value, "^[1-9][0-9]*$") && Int64(value).map { $0 > 0 } == true
    }

    static func validTimestamp(_ value: String) -> Bool {
        matches(value, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$")
            && PostgresTimestamp.date(from: value) != nil
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
            throw corrupted(decoder, "Unexpected catalog preparation response fields.")
        }
    }
}

private extension KeyedDecodingContainer {
    func decodeCatalogPreparationUUID(forKey key: Key) throws -> UUID {
        let raw = try decode(String.self, forKey: key)
        guard CatalogPreparationContract.validIntakeID(raw), let value = UUID(uuidString: raw) else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: self, debugDescription: "Expected a canonical lowercase UUID."
            )
        }
        return value
    }
}
