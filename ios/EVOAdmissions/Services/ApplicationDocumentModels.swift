import Foundation

// Closed wire values stay separate from persisted command intentions and the
// legacy material projection nested in requirements.
indirect enum ApplicationDocumentJSON: Codable, Equatable, Sendable {
    case object([String: Self]), array([Self]), string(String), integer(Int), bool(Bool), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Int.self) { self = .integer(v) }
        else if let v = try? c.decode([String: Self].self) { self = .object(v) }
        else { self = .array(try c.decode([Self].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .integer(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    func object(_ keys: String) throws -> [String: Self] {
        guard case .object(let v) = self, Set(v.keys) == Set(keys.split(separator: " ").map(String.init)) else { throw ApplicationDocumentClientError.invalidResponse }
        return v
    }
    func string() throws -> String {
        guard case .string(let v) = self else { throw ApplicationDocumentClientError.invalidResponse }; return v
    }
    func uuid() throws -> String {
        let v = try string(); guard ApplicationDocumentWire.uuid(v) else { throw ApplicationDocumentClientError.invalidResponse }; return v
    }
    func version() throws -> String {
        let v = try string()
        guard ApplicationDocumentWire.matches(v, "^[1-9][0-9]*$"), v.utf8.count <= 19, let n = Int64(v), n > 0 else { throw ApplicationDocumentClientError.invalidResponse }; return v
    }
    func boolean() throws -> Bool {
        guard case .bool(let v) = self else { throw ApplicationDocumentClientError.invalidResponse }; return v
    }
    func array() throws -> [Self] {
        guard case .array(let v) = self else { throw ApplicationDocumentClientError.invalidResponse }; return v
    }
    func text(_ maximum: Int = Int.max) throws -> String {
        let v = try string()
        guard !v.trimmingCharacters(in: ApplicationDocumentWire.trimCharacters).isEmpty, v.unicodeScalars.count <= maximum else { throw ApplicationDocumentClientError.invalidResponse }; return v
    }
    func timestamp() throws -> String {
        let v = try string()
        guard ApplicationDocumentWire.matches(v, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$"),
              ApplicationDocumentWire.calendarDate(String(v.prefix(10))), PostgresTimestamp.date(from: v) != nil else { throw ApplicationDocumentClientError.invalidResponse }
        return v
    }
    func nullableText() throws -> String? {
        try optional { value in
            let v = try value.string()
            guard !v.contains("\u{0}"), v.isEmpty || !v.trimmingCharacters(in: ApplicationDocumentWire.trimCharacters).isEmpty else { throw ApplicationDocumentClientError.invalidResponse }
            return v
        }
    }
    func optional<T>(_ transform: (Self) throws -> T) throws -> T? { self == .null ? nil : try transform(self) }
    func decode<T: Decodable>(_ type: T.Type) throws -> T { try JSONDecoder().decode(type, from: JSONEncoder().encode(self)) }
}
private extension Dictionary where Key == String, Value == ApplicationDocumentJSON {
    subscript(w key: String) -> Value { self[key] ?? .null }
}

enum ApplicationDocumentUnavailableReason: String, Decodable {
    case fileMissing = "file_missing", uploadNotFinalized = "upload_not_finalized"
    case integrityPending = "integrity_pending", integrityFailed = "integrity_failed"
    case malwarePending = "malware_pending", malwareInfected = "malware_infected", malwareError = "malware_error"
    case storageObjectUnavailable = "storage_object_unavailable", scanProofUnavailable = "scan_proof_unavailable"
}
struct ApplicationDocumentFileSummary: Identifiable {
    var id: String { documentVersionId }
    let documentVersionId: String
    let versionNo: String
    let file: ApplicationDocumentFile
    let finalizedAt: String
    let technicalAvailability: ApplicationRequirementTechnicalAvailability
    let unavailableReasons: [ApplicationDocumentUnavailableReason]
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("documentVersionId versionNo originalFilename declaredMimeType byteSize sha256Hex finalizedAt technicalAvailability unavailableReasons")
        documentVersionId = try r[w: "documentVersionId"].uuid(); versionNo = try r[w: "versionNo"].version()
        file = try ApplicationDocumentJSON.object(r.filter { ["originalFilename", "declaredMimeType", "byteSize", "sha256Hex"].contains($0.key) }).decode(ApplicationDocumentFile.self)
        try file.validate(allowLegacyFilename: true)
        finalizedAt = try r[w: "finalizedAt"].timestamp()
        technicalAvailability = try r[w: "technicalAvailability"].decode(ApplicationRequirementTechnicalAvailability.self)
        unavailableReasons = try r[w: "unavailableReasons"].decode([ApplicationDocumentUnavailableReason].self)
        let allowed = Set(["file_missing", "upload_not_finalized", "integrity_pending", "integrity_failed", "malware_pending", "malware_infected", "malware_error", "storage_object_unavailable", "scan_proof_unavailable"])
        let reasons = unavailableReasons.map(\.rawValue)
        guard Set(reasons).count == reasons.count, reasons.allSatisfy(allowed.contains),
              (technicalAvailability == .available) == reasons.isEmpty,
              reasons.filter({ $0.hasPrefix("integrity_") }).count <= 1,
              reasons.filter({ $0.hasPrefix("malware_") }).count <= 1 else { throw ApplicationDocumentClientError.invalidResponse }
    }
}
struct ApplicationDocumentUploadSummary {
    let uploadContextId: String, requirementsRevisionId: String, requirementItemId: String, documentSlotId: String, admittedAt: String
    let file: ApplicationDocumentFileSummary
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("uploadContextId requirementsRevisionId requirementItemId documentSlotId admittedAt file")
        uploadContextId = try r[w: "uploadContextId"].uuid(); requirementsRevisionId = try r[w: "requirementsRevisionId"].uuid()
        requirementItemId = try r[w: "requirementItemId"].uuid(); documentSlotId = try r[w: "documentSlotId"].uuid()
        admittedAt = try r[w: "admittedAt"].timestamp(); file = try ApplicationDocumentFileSummary(r[w: "file"])
    }
}
struct ApplicationDocumentReview {
    let reviewId: String, decision: ApplicationRequirementReviewDecision, reason: String?, reviewedAt: String
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("reviewId decision reason reviewedAt")
        reviewId = try r[w: "reviewId"].uuid(); decision = try r[w: "decision"].decode(ApplicationRequirementReviewDecision.self)
        reason = try r[w: "reason"].optional { try $0.text(2000) }; reviewedAt = try r[w: "reviewedAt"].timestamp()
        guard reason.map({ !$0.unicodeScalars.contains { $0.properties.generalCategory == .control && ![9, 10, 13].contains($0.value) } }) ?? true,
              decision == .approved ? reason == nil : reason != nil else { throw ApplicationDocumentClientError.invalidResponse }
    }
}
struct ApplicationDocumentSubmission {
    let submissionId: String, requirementsRevisionId: String, requirementItemId: String, documentSlotId: String, submittedAt: String
    let file: ApplicationDocumentFileSummary
    let review: ApplicationDocumentReview?
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("submissionId requirementsRevisionId requirementItemId documentSlotId submittedAt file review")
        submissionId = try r[w: "submissionId"].uuid(); requirementsRevisionId = try r[w: "requirementsRevisionId"].uuid()
        requirementItemId = try r[w: "requirementItemId"].uuid(); documentSlotId = try r[w: "documentSlotId"].uuid()
        submittedAt = try r[w: "submittedAt"].timestamp(); file = try ApplicationDocumentFileSummary(r[w: "file"])
        review = try r[w: "review"].optional(ApplicationDocumentReview.init)
    }
}
struct ApplicationDocumentDefinition {
    let requirementKey: String, required: Bool, label: String, groupLabel: String, instructions: String, documentSlotId: String
    let deadline: ApplicationRequirementDeadline?
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("requirementKey required label groupLabel instructions deadline documentSlotId")
        requirementKey = try r[w: "requirementKey"].text(100)
        guard ApplicationDocumentWire.matches(requirementKey, "^[a-z][a-z0-9_.-]*$") else { throw ApplicationDocumentClientError.invalidResponse }
        required = try r[w: "required"].boolean(); label = try r[w: "label"].text(500)
        groupLabel = try r[w: "groupLabel"].text(200)
        guard let instructions = try r[w: "instructions"].nullableText() else { throw ApplicationDocumentClientError.invalidResponse }
        self.instructions = instructions
        documentSlotId = try r[w: "documentSlotId"].uuid()
        deadline = try r[w: "deadline"].optional { try $0.decode(ApplicationRequirementDeadline.self) }
    }
}
enum ApplicationDocumentMaterialKind: String, Decodable {
    case baseline, custom
}

/// Immutable material mapping as it existed for this historical evidence.
/// Source identities are preserved for correlation, never used as UI labels.
struct ApplicationDocumentMaterialSnapshot {
    let intentKind: ApplicationDocumentMaterialKind
    let requirementId: String?
    let rawLabel: String?, rawGroupLabel: String?
    let label: String, groupLabel: String
    let sourceRequirementKey: String?, sourceChecklistVersion: String?, sourceInstructions: String?

    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("intentKind requirementId rawLabel rawGroupLabel label groupLabel sourceRequirementKey sourceChecklistVersion sourceInstructions")
        intentKind = try r[w: "intentKind"].decode(ApplicationDocumentMaterialKind.self)
        requirementId = try r[w: "requirementId"].optional { try $0.uuid() }
        rawLabel = try r[w: "rawLabel"].nullableText(); rawGroupLabel = try r[w: "rawGroupLabel"].nullableText()
        label = try r[w: "label"].text(); groupLabel = try r[w: "groupLabel"].text()
        sourceRequirementKey = try r[w: "sourceRequirementKey"].nullableText()
        sourceChecklistVersion = try r[w: "sourceChecklistVersion"].optional { try $0.version() }
        sourceInstructions = try r[w: "sourceInstructions"].nullableText()
        switch intentKind {
        case .custom:
            guard requirementId == nil, sourceRequirementKey == nil, sourceChecklistVersion == nil, sourceInstructions == nil else {
                throw ApplicationDocumentClientError.invalidResponse
            }
        case .baseline:
            guard requirementId != nil, sourceChecklistVersion != nil, let sourceRequirementKey,
                  !sourceRequirementKey.trimmingCharacters(in: ApplicationDocumentWire.trimCharacters).isEmpty else {
                throw ApplicationDocumentClientError.invalidResponse
            }
        }
    }
}

struct ApplicationDocumentHistoryEntry: Identifiable {
    let id: String, kind: String, createdAt: String, requirementsRevisionId: String, requirementItemId: String
    let definition: ApplicationDocumentDefinition
    let materialSnapshot: ApplicationDocumentMaterialSnapshot?
    let upload: ApplicationDocumentUploadSummary?
    let submission: ApplicationDocumentSubmission?
    var file: ApplicationDocumentFileSummary { upload?.file ?? submission!.file }
    var selection: ApplicationDocumentSelection {
        if let upload { return .init(kind: "program_upload", documentVersionId: upload.file.id, uploadContextId: upload.uploadContextId) }
        return .init(kind: "submission", documentVersionId: submission!.file.id, submissionId: submission!.submissionId)
    }
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("id kind createdAt requirementsRevisionId requirementItemId definition materialSnapshot upload submission")
        id = try r[w: "id"].uuid(); kind = try r[w: "kind"].string(); createdAt = try r[w: "createdAt"].timestamp()
        requirementsRevisionId = try r[w: "requirementsRevisionId"].uuid(); requirementItemId = try r[w: "requirementItemId"].uuid()
        definition = try ApplicationDocumentDefinition(r[w: "definition"])
        materialSnapshot = try r[w: "materialSnapshot"].optional(ApplicationDocumentMaterialSnapshot.init)
        upload = try r[w: "upload"].optional(ApplicationDocumentUploadSummary.init)
        submission = try r[w: "submission"].optional(ApplicationDocumentSubmission.init)
        guard (kind == "upload" && upload != nil && submission == nil) || (kind == "submission" && submission != nil && upload == nil),
              (upload?.uploadContextId ?? submission?.submissionId) == id,
              (upload?.requirementsRevisionId ?? submission?.requirementsRevisionId) == requirementsRevisionId,
              (upload?.requirementItemId ?? submission?.requirementItemId) == requirementItemId,
              (upload?.documentSlotId ?? submission?.documentSlotId) == definition.documentSlotId else { throw ApplicationDocumentClientError.invalidResponse }
    }
}
struct ApplicationDocumentSelection: Codable, Equatable {
    let kind: String, documentVersionId: String
    var uploadContextId: String? = nil
    var submissionId: String? = nil
    func validate(allowSubmission: Bool = false) throws {
        guard ApplicationDocumentWire.uuid(documentVersionId),
              (kind == "program_upload" && uploadContextId.map(ApplicationDocumentWire.uuid) == true && submissionId == nil)
                || (kind == "existing_version" && uploadContextId == nil && submissionId == nil)
                || (allowSubmission && kind == "submission" && uploadContextId == nil && submissionId.map(ApplicationDocumentWire.uuid) == true)
        else { throw ApplicationDocumentClientError.invalidIntent }
    }
}
struct ApplicationDocumentReusableVersion: Identifiable {
    var id: String { file.id }
    let selection: ApplicationDocumentSelection, file: ApplicationDocumentFileSummary
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("selection file")
        let s = try r[w: "selection"].object("kind documentVersionId")
        guard try s[w: "kind"].string() == "existing_version" else { throw ApplicationDocumentClientError.invalidResponse }
        selection = ApplicationDocumentSelection(kind: "existing_version", documentVersionId: try s[w: "documentVersionId"].uuid())
        file = try ApplicationDocumentFileSummary(r[w: "file"])
        guard file.id == selection.documentVersionId else { throw ApplicationDocumentClientError.invalidResponse }
    }
}
struct ApplicationDocumentVersionCursor: Codable, Equatable {
    let versionNo: String, documentVersionId: String
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("versionNo documentVersionId")
        versionNo = try r[w: "versionNo"].version(); documentVersionId = try r[w: "documentVersionId"].uuid()
    }
}
struct ApplicationDocumentHistoryCursor: Codable, Equatable {
    let createdAt: String, id: String
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("createdAt id"); createdAt = try r[w: "createdAt"].timestamp(); id = try r[w: "id"].uuid()
    }
}
struct ApplicationDocumentItem: Identifiable {
    var id: String { requirementItemId }
    let requirementItemId: String, documentSlotId: String
    let savedDraft: ApplicationDocumentUploadSummary?, submission: ApplicationDocumentSubmission?, previousEvidence: ApplicationDocumentHistoryEntry?
    let reusableVersions: [ApplicationDocumentReusableVersion], reusableVersionsNextCursor: ApplicationDocumentVersionCursor?
    let canUpload: Bool, canSubmit: Bool
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("requirementItemId documentSlotId savedDraft submission previousEvidence reusableVersions reusableVersionsNextCursor canUpload canSubmit")
        requirementItemId = try r[w: "requirementItemId"].uuid(); documentSlotId = try r[w: "documentSlotId"].uuid()
        savedDraft = try r[w: "savedDraft"].optional(ApplicationDocumentUploadSummary.init)
        submission = try r[w: "submission"].optional(ApplicationDocumentSubmission.init)
        previousEvidence = try r[w: "previousEvidence"].optional(ApplicationDocumentHistoryEntry.init)
        reusableVersions = try r[w: "reusableVersions"].array().map(ApplicationDocumentReusableVersion.init)
        reusableVersionsNextCursor = try r[w: "reusableVersionsNextCursor"].optional(ApplicationDocumentVersionCursor.init)
        canUpload = try r[w: "canUpload"].boolean(); canSubmit = try r[w: "canSubmit"].boolean()
        guard reusableVersions.count <= 20, ApplicationDocumentWire.versionPage(reusableVersions, cursor: reusableVersionsNextCursor) else { throw ApplicationDocumentClientError.invalidResponse }
    }
}
struct ApplicationDocumentsView: Decodable {
    let studentCaseId: String, applicationId: String
    let requirements: ApplicationRequirementsV2View
    let items: [ApplicationDocumentItem]
    init(from decoder: Decoder) throws {
        let r = try ApplicationDocumentJSON(from: decoder).object("protocolVersion studentCaseId applicationId requirements items")
        guard r[w: "protocolVersion"] == .integer(1) else { throw ApplicationDocumentClientError.invalidResponse }
        studentCaseId = try r[w: "studentCaseId"].uuid(); applicationId = try r[w: "applicationId"].uuid()
        requirements = try r[w: "requirements"].decode(ApplicationRequirementsV2View.self)
        try requirements.validate(studentCaseId: UUID(uuidString: studentCaseId)!, applicationId: UUID(uuidString: applicationId)!)
        items = try r[w: "items"].array().map(ApplicationDocumentItem.init)
        guard items.count <= 50, items.count == requirements.items.count else { throw ApplicationDocumentClientError.invalidResponse }
        for (item, requirement) in zip(items, requirements.items) {
            guard item.id == requirement.id.uuidString.lowercased(), item.documentSlotId == requirement.documentSlotId.uuidString.lowercased() else { throw ApplicationDocumentClientError.invalidResponse }
            let revision = requirements.revision?.revisionId.uuidString.lowercased()
            if let draft = item.savedDraft {
                guard draft.requirementItemId == item.id, draft.documentSlotId == item.documentSlotId, draft.requirementsRevisionId == revision else { throw ApplicationDocumentClientError.invalidResponse }
            }
            if let submission = item.submission {
                guard submission.requirementItemId == item.id, submission.documentSlotId == item.documentSlotId, submission.requirementsRevisionId == revision else { throw ApplicationDocumentClientError.invalidResponse }
            }
            if let old = item.previousEvidence {
                guard old.requirementItemId != item.id else { throw ApplicationDocumentClientError.invalidResponse }
            }
        }
    }
    func validate(studentCaseId: UUID, applicationId: UUID) throws {
        guard self.studentCaseId == studentCaseId.uuidString.lowercased(), self.applicationId == applicationId.uuidString.lowercased() else { throw ApplicationDocumentClientError.invalidResponse }
    }
}
struct ApplicationDocumentHistory: Decodable {
    let studentCaseId: String, applicationId: String, requirementItemId: String?
    let events: [ApplicationDocumentHistoryEntry], nextCursor: ApplicationDocumentHistoryCursor?
    init(from decoder: Decoder) throws {
        let r = try ApplicationDocumentJSON(from: decoder).object("protocolVersion studentCaseId applicationId requirementItemId events nextCursor")
        guard r[w: "protocolVersion"] == .integer(1) else { throw ApplicationDocumentClientError.invalidResponse }
        studentCaseId = try r[w: "studentCaseId"].uuid(); applicationId = try r[w: "applicationId"].uuid()
        requirementItemId = try r[w: "requirementItemId"].optional { try $0.uuid() }
        events = try r[w: "events"].array().map(ApplicationDocumentHistoryEntry.init)
        nextCursor = try r[w: "nextCursor"].optional(ApplicationDocumentHistoryCursor.init)
        guard events.count <= 50, ApplicationDocumentWire.historyPage(events, cursor: nextCursor) else { throw ApplicationDocumentClientError.invalidResponse }
    }
}
struct ApplicationDocumentReusablePage: Decodable {
    let studentCaseId: String, applicationId: String, requirementItemId: String
    let versions: [ApplicationDocumentReusableVersion], nextCursor: ApplicationDocumentVersionCursor?
    init(from decoder: Decoder) throws {
        let r = try ApplicationDocumentJSON(from: decoder).object("protocolVersion studentCaseId applicationId requirementItemId versions nextCursor")
        guard r[w: "protocolVersion"] == .integer(1) else { throw ApplicationDocumentClientError.invalidResponse }
        studentCaseId = try r[w: "studentCaseId"].uuid(); applicationId = try r[w: "applicationId"].uuid(); requirementItemId = try r[w: "requirementItemId"].uuid()
        versions = try r[w: "versions"].array().map(ApplicationDocumentReusableVersion.init)
        nextCursor = try r[w: "nextCursor"].optional(ApplicationDocumentVersionCursor.init)
        guard versions.count <= 50, ApplicationDocumentWire.versionPage(versions, cursor: nextCursor) else { throw ApplicationDocumentClientError.invalidResponse }
    }
}

struct ApplicationDocumentSubmitIntent: ApplicationDocumentPersistedIntent {
    static let operation = "submit"
    let studentCaseId: String, applicationId: String, requirementsRevisionId: String, requirementItemId: String
    let documentSlotId: String // client correlation, not an RPC authority input
    let selection: ApplicationDocumentSelection
    let expectedPreviousSubmissionId: String?
    func validate() throws {
        guard [studentCaseId, applicationId, requirementsRevisionId, requirementItemId, documentSlotId].allSatisfy(ApplicationDocumentWire.uuid),
              expectedPreviousSubmissionId.map(ApplicationDocumentWire.uuid) ?? true else { throw ApplicationDocumentClientError.invalidIntent }
        try selection.validate()
    }
    func parameters(requestId: String) throws -> ApplicationDocumentJSON {
        try validate()
        guard ApplicationDocumentWire.uuid(requestId) else { throw ApplicationDocumentClientError.invalidIntent }
        return .object([
            "p_student_case_id": .string(studentCaseId), "p_application_id": .string(applicationId),
            "p_requirements_revision_id": .string(requirementsRevisionId), "p_requirement_item_id": .string(requirementItemId),
            "p_selection": try JSONDecoder().decode(ApplicationDocumentJSON.self, from: JSONEncoder().encode(selection)),
            "p_expected_previous_submission_id": expectedPreviousSubmissionId.map(ApplicationDocumentJSON.string) ?? .null,
            "p_request_id": .string(requestId)
        ])
    }
}
struct ApplicationDocumentSubmitReceipt: Decodable {
    let requestId: String, submissionId: String, studentCaseId: String, applicationId: String
    let requirementsRevisionId: String, requirementItemId: String, documentSlotId: String, documentVersionId: String
    let versionNo: String, submittedAt: String, reused: Bool
    init(from decoder: Decoder) throws {
        let r = try ApplicationDocumentJSON(from: decoder).object("protocolVersion requestId submissionId studentCaseId applicationId requirementsRevisionId requirementItemId documentSlotId documentVersionId versionNo submittedAt reused")
        guard r[w: "protocolVersion"] == .integer(1) else { throw ApplicationDocumentClientError.invalidResponse }
        requestId = try r[w: "requestId"].uuid(); submissionId = try r[w: "submissionId"].uuid()
        studentCaseId = try r[w: "studentCaseId"].uuid(); applicationId = try r[w: "applicationId"].uuid()
        requirementsRevisionId = try r[w: "requirementsRevisionId"].uuid(); requirementItemId = try r[w: "requirementItemId"].uuid()
        documentSlotId = try r[w: "documentSlotId"].uuid(); documentVersionId = try r[w: "documentVersionId"].uuid()
        versionNo = try r[w: "versionNo"].version(); submittedAt = try r[w: "submittedAt"].timestamp(); reused = try r[w: "reused"].boolean()
    }
    func validate(_ intent: ApplicationDocumentSubmitIntent, requestId: String) throws {
        guard self.requestId == requestId, studentCaseId == intent.studentCaseId, applicationId == intent.applicationId,
              requirementsRevisionId == intent.requirementsRevisionId, requirementItemId == intent.requirementItemId,
              documentSlotId == intent.documentSlotId, documentVersionId == intent.selection.documentVersionId else { throw ApplicationDocumentClientError.invalidResponse }
    }
}
struct ApplicationDocumentUploadReceipt: Decodable {
    let requestId: String, uploadContextId: String, studentCaseId: String, applicationId: String, requirementsRevisionId: String
    let requirementItemId: String, documentSlotId: String, documentVersionId: String, versionNo: String, finalizedAt: String
    let file: ApplicationDocumentFile
    init(from decoder: Decoder) throws {
        let r = try ApplicationDocumentJSON(from: decoder).object("protocolVersion requestId uploadContextId studentCaseId applicationId requirementsRevisionId requirementItemId documentSlotId documentVersionId versionNo file finalizedAt publishedToLegacySlot")
        guard r[w: "protocolVersion"] == .integer(1), r[w: "publishedToLegacySlot"] == .bool(false) else { throw ApplicationDocumentClientError.invalidResponse }
        requestId = try r[w: "requestId"].uuid(); uploadContextId = try r[w: "uploadContextId"].uuid()
        studentCaseId = try r[w: "studentCaseId"].uuid(); applicationId = try r[w: "applicationId"].uuid()
        requirementsRevisionId = try r[w: "requirementsRevisionId"].uuid(); requirementItemId = try r[w: "requirementItemId"].uuid()
        documentSlotId = try r[w: "documentSlotId"].uuid(); documentVersionId = try r[w: "documentVersionId"].uuid()
        versionNo = try r[w: "versionNo"].version(); finalizedAt = try r[w: "finalizedAt"].timestamp()
        _ = try r[w: "file"].object("originalFilename declaredMimeType byteSize sha256Hex")
        file = try r[w: "file"].decode(ApplicationDocumentFile.self); try file.validate()
    }
    static func decodeEnvelope(_ data: Data, intent: ApplicationDocumentUploadIntent, requestId: String) throws -> Self {
        let envelope = try JSONDecoder().decode(ApplicationDocumentJSON.self, from: data).object("upload")
        let receipt = try envelope[w: "upload"].decode(Self.self)
        guard receipt.requestId == requestId, receipt.studentCaseId == intent.studentCaseId, receipt.applicationId == intent.applicationId,
              receipt.requirementsRevisionId == intent.requirementsRevisionId, receipt.requirementItemId == intent.requirementItemId,
              receipt.documentSlotId == intent.documentSlotId, receipt.file == intent.file else { throw ApplicationDocumentClientError.invalidResponse }
        return receipt
    }
}


extension ApplicationDocumentWire {
    static func calendarDate(_ date: String) -> Bool {
        let values = date.split(separator: "-").compactMap { Int($0) }
        guard values.count == 3 else { return false }
        let (year, month, day) = (values[0], values[1], values[2])
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
        let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        return year > 0 && (1...12).contains(month) && day > 0 && day <= days[month - 1]
    }
    static func microseconds(_ timestamp: String) -> Int64 {
        let seconds = Int64(PostgresTimestamp.date(from: timestamp)!.timeIntervalSince1970.rounded())
        let fraction = timestamp.split(separator: ".").dropFirst().first.map { String($0.prefix(while: { $0.isNumber })) } ?? ""
        return seconds * 1_000_000 + (Int64((fraction + "000000").prefix(6)) ?? 0)
    }
    static func versionPage(_ versions: [ApplicationDocumentReusableVersion], cursor: ApplicationDocumentVersionCursor?) -> Bool {
        guard Set(versions.map(\.id)).count == versions.count else { return false }
        for (before, after) in zip(versions, versions.dropFirst()) {
            let a = Int64(before.file.versionNo)!, b = Int64(after.file.versionNo)!
            guard a > b || (a == b && before.id > after.id) else { return false }
        }
        return cursor == nil || (versions.last?.id == cursor?.documentVersionId && versions.last?.file.versionNo == cursor?.versionNo)
    }
    static func historyPage(_ events: [ApplicationDocumentHistoryEntry], cursor: ApplicationDocumentHistoryCursor?) -> Bool {
        guard Set(events.map(\.id)).count == events.count else { return false }
        for (before, after) in zip(events, events.dropFirst()) {
            let a = microseconds(before.createdAt), b = microseconds(after.createdAt)
            guard a > b || (a == b && before.id > after.id) else { return false }
        }
        guard let cursor else { return true }
        return events.last?.id == cursor.id && events.last.map { microseconds($0.createdAt) == microseconds(cursor.createdAt) } == true
    }
}

enum ApplicationDocumentFailureCode: String, Decodable {
    case invalid, forbidden, requestConflict = "request_conflict", staleContext = "stale_context"
    case caseIneligible = "case_ineligible", applicationIneligible = "application_ineligible", fileUnavailable = "file_unavailable"
    case busy, leaseExpired = "lease_expired", fileTooLarge = "file_too_large", unsupportedType = "unsupported_type"
    case malwareDetected = "malware_detected", rateLimited = "rate_limited", unavailable
}
struct ApplicationDocumentDefinitiveFailure: Error { let key: String }
struct ApplicationDocumentHTTPFailure: Error {
    let code: ApplicationDocumentFailureCode, notWritten: Bool
    static func decode(_ data: Data) throws -> Self {
        let outer = try JSONDecoder().decode(ApplicationDocumentJSON.self, from: data).object("error")
        let r = try outer[w: "error"].object("code resolution")
        let code = try r[w: "code"].decode(ApplicationDocumentFailureCode.self)
        let resolution = try r[w: "resolution"].string()
        guard ["retain", "not_written"].contains(resolution) else { throw ApplicationDocumentClientError.invalidResponse }
        return Self(code: code, notWritten: resolution == "not_written" && code != .forbidden && code != .requestConflict)
    }
}

struct ApplicationDocumentNotification: Decodable {
    let notificationId: String, studentCaseId: String, applicationId: String
    let requirementsRevisionId: String, requirementItemId: String, documentSlotId: String, reviewId: String
    let submission: ApplicationDocumentSubmission
    init(from decoder: Decoder) throws {
        let r = try ApplicationDocumentJSON(from: decoder).object("protocolVersion notificationId studentCaseId applicationId requirementsRevisionId requirementItemId documentSlotId reviewId submission")
        guard r[w: "protocolVersion"] == .integer(1) else { throw ApplicationDocumentClientError.invalidResponse }
        notificationId = try r[w: "notificationId"].uuid(); studentCaseId = try r[w: "studentCaseId"].uuid()
        applicationId = try r[w: "applicationId"].uuid(); requirementsRevisionId = try r[w: "requirementsRevisionId"].uuid()
        requirementItemId = try r[w: "requirementItemId"].uuid(); documentSlotId = try r[w: "documentSlotId"].uuid(); reviewId = try r[w: "reviewId"].uuid()
        submission = try ApplicationDocumentSubmission(r[w: "submission"])
        guard submission.requirementsRevisionId == requirementsRevisionId, submission.requirementItemId == requirementItemId,
              submission.documentSlotId == documentSlotId, submission.review?.reviewId == reviewId else { throw ApplicationDocumentClientError.invalidResponse }
    }
}
