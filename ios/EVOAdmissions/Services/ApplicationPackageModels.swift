import Foundation

// B3g package wire v1. Existing 228 leaves retain their own closed decoders;
// package readiness deliberately does not use the 50-item Documents aggregate.
enum ApplicationPackageClientError: Error, Equatable {
    case invalidResponse, invalidIntent, pendingUnavailable, unresolvedIntent
}

private extension Dictionary where Key == String, Value == ApplicationDocumentJSON {
    subscript(p key: String) -> Value { self[key] ?? .null }
}

protocol ApplicationPackageRawDecodable: Decodable {
    init(_ raw: ApplicationDocumentJSON) throws
}
extension ApplicationPackageRawDecodable {
    init(from decoder: Decoder) throws { try self.init(ApplicationDocumentJSON(from: decoder)) }
}

enum ApplicationPackageOperation: String, Codable { case submit, review }
enum ApplicationPackageDecision: String, Codable { case approved, correctionRequired = "correction_required" }
enum ApplicationPackageReadyReason: String, Decodable {
    case requirementsUnavailable = "requirements_unavailable", emptyComposition = "empty_composition"
    case missingRequired = "missing_required", materialUnavailable = "material_unavailable"
    case fileUnavailable = "file_unavailable", previousSubmissionChanged = "previous_submission_changed"
}
enum ApplicationPackageWarningReason: String, Decodable { case reviewChanged = "review_changed", fileUnavailable = "file_unavailable" }

enum ApplicationPackageWire {
    static func require(_ condition: Bool) throws {
        guard condition else { throw ApplicationPackageClientError.invalidResponse }
    }
    static func nullable(_ value: String?) -> ApplicationDocumentJSON { value.map(ApplicationDocumentJSON.string) ?? .null }
    static func array(_ raw: ApplicationDocumentJSON, minimum: Int = 0, maximum: Int = 100) throws -> [ApplicationDocumentJSON] {
        let values = try raw.array(); try require((minimum...maximum).contains(values.count)); return values
    }
    static func ids(_ raw: ApplicationDocumentJSON, maximum: Int = 100) throws -> [String] {
        let values = try array(raw, maximum: maximum).map { try $0.uuid() }
        try unique(values); return values
    }
    static func unique(_ values: [String]) throws { try require(Set(values).count == values.count) }
    static func hash(_ raw: ApplicationDocumentJSON) throws -> String {
        let value = try raw.string(); try require(ApplicationDocumentWire.matches(value, "^[0-9a-f]{64}$")); return value
    }
    static func selection(_ raw: ApplicationDocumentJSON) throws -> ApplicationDocumentSelection {
        guard case .object(let values) = raw else { throw ApplicationPackageClientError.invalidResponse }
        let kind = try values[p: "kind"].string()
        _ = try raw.object(kind == "program_upload" ? "kind documentVersionId uploadContextId" : "kind documentVersionId")
        let value = try raw.decode(ApplicationDocumentSelection.self); try value.validate(); return value
    }
    static func selectionJSON(_ value: ApplicationDocumentSelection) throws -> ApplicationDocumentJSON {
        try value.validate(); return try JSONDecoder().decode(ApplicationDocumentJSON.self, from: JSONEncoder().encode(value))
    }
    static func reason(_ raw: ApplicationDocumentJSON, decision: ApplicationPackageDecision, affected: [String]) throws -> String? {
        let value = try raw.optional { try $0.text(5000) }
        try require(value.map { !$0.contains("\u{0000}") } ?? true)
        try require(decision == .approved ? value == nil && affected.isEmpty : value != nil)
        return value
    }
    static func page(_ rows: [(String, String)], cursor: ApplicationDocumentHistoryCursor?) throws {
        try unique(rows.map(\.1))
        for (before, after) in zip(rows, rows.dropFirst()) {
            let a = ApplicationDocumentWire.microseconds(before.0), b = ApplicationDocumentWire.microseconds(after.0)
            try require(a > b || (a == b && before.1 > after.1))
        }
        if let cursor {
            guard let last = rows.last else { throw ApplicationPackageClientError.invalidResponse }
            try require(last.1 == cursor.id && ApplicationDocumentWire.microseconds(last.0) == ApplicationDocumentWire.microseconds(cursor.createdAt))
        }
    }
    static func sameReview(_ a: ApplicationDocumentReview?, _ b: ApplicationDocumentReview?) -> Bool {
        guard let a, let b else { return a == nil && b == nil }
        return a.reviewId == b.reviewId && a.decision == b.decision && a.reason == b.reason && a.reviewedAt == b.reviewedAt
    }
}

struct ApplicationPackageSelectionItem: Codable, Equatable, ApplicationPackageRawDecodable {
    let requirementItemId: String
    let selection: ApplicationDocumentSelection
    let expectedPreviousSubmissionId: String?
    init(requirementItemId: String, selection: ApplicationDocumentSelection, expectedPreviousSubmissionId: String?) throws {
        self.requirementItemId = requirementItemId; self.selection = selection; self.expectedPreviousSubmissionId = expectedPreviousSubmissionId
        try validate()
    }
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("requirementItemId selection expectedPreviousSubmissionId")
        try self.init(requirementItemId: r[p: "requirementItemId"].uuid(), selection: ApplicationPackageWire.selection(r[p: "selection"]),
                      expectedPreviousSubmissionId: r[p: "expectedPreviousSubmissionId"].optional { try $0.uuid() })
    }
    func validate() throws {
        try ApplicationPackageWire.require(ApplicationDocumentWire.uuid(requirementItemId) && (expectedPreviousSubmissionId.map(ApplicationDocumentWire.uuid) ?? true))
        try selection.validate()
    }
    var raw: ApplicationDocumentJSON { get throws {
        .object(["requirementItemId": .string(requirementItemId), "selection": try ApplicationPackageWire.selectionJSON(selection),
                 "expectedPreviousSubmissionId": ApplicationPackageWire.nullable(expectedPreviousSubmissionId)])
    } }
    func encode(to encoder: Encoder) throws { try raw.encode(to: encoder) }
}

struct ApplicationPackageDocumentExpectation: Codable, Equatable, ApplicationPackageRawDecodable {
    let requirementItemId: String, submissionId: String
    let expectedReviewId: String?
    init(requirementItemId: String, submissionId: String, expectedReviewId: String?) throws {
        self.requirementItemId = requirementItemId; self.submissionId = submissionId; self.expectedReviewId = expectedReviewId
        try validate()
    }
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("requirementItemId submissionId expectedReviewId")
        try self.init(requirementItemId: r[p: "requirementItemId"].uuid(), submissionId: r[p: "submissionId"].uuid(),
                      expectedReviewId: r[p: "expectedReviewId"].optional { try $0.uuid() })
    }
    func validate() throws {
        try ApplicationPackageWire.require([requirementItemId, submissionId].allSatisfy(ApplicationDocumentWire.uuid) && (expectedReviewId.map(ApplicationDocumentWire.uuid) ?? true))
    }
    var raw: ApplicationDocumentJSON { .object(["requirementItemId": .string(requirementItemId), "submissionId": .string(submissionId), "expectedReviewId": ApplicationPackageWire.nullable(expectedReviewId)]) }
    func encode(to encoder: Encoder) throws { try raw.encode(to: encoder) }
}

struct ApplicationPackageReuseApproval: Codable, Equatable, ApplicationPackageRawDecodable {
    let expectation: ApplicationPackageDocumentExpectation
    let sourceSubmissionId: String, sourceReviewId: String
    init(expectation: ApplicationPackageDocumentExpectation, sourceSubmissionId: String, sourceReviewId: String) throws {
        self.expectation = expectation; self.sourceSubmissionId = sourceSubmissionId; self.sourceReviewId = sourceReviewId
        try validate()
    }
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("requirementItemId submissionId expectedReviewId sourceSubmissionId sourceReviewId")
        try self.init(expectation: .init(.object(r.filter { ["requirementItemId", "submissionId", "expectedReviewId"].contains($0.key) })),
                      sourceSubmissionId: r[p: "sourceSubmissionId"].uuid(), sourceReviewId: r[p: "sourceReviewId"].uuid())
    }
    func validate() throws {
        try expectation.validate(); try ApplicationPackageWire.require([sourceSubmissionId, sourceReviewId].allSatisfy(ApplicationDocumentWire.uuid)
            && sourceSubmissionId != expectation.submissionId)
    }
    var raw: ApplicationDocumentJSON {
        .object(["requirementItemId": .string(expectation.requirementItemId), "submissionId": .string(expectation.submissionId),
                 "expectedReviewId": ApplicationPackageWire.nullable(expectation.expectedReviewId), "sourceSubmissionId": .string(sourceSubmissionId), "sourceReviewId": .string(sourceReviewId)])
    }
    func encode(to encoder: Encoder) throws { try raw.encode(to: encoder) }
}

protocol ApplicationPackagePersistedIntent: Codable, Equatable {
    static var operation: ApplicationPackageOperation { get }
    var studentCaseId: String { get }
    var applicationId: String { get }
    var requestId: String { get }
    var recoveryTargetId: String { get }
    var raw: ApplicationDocumentJSON { get throws }
    func validate() throws
}
extension ApplicationPackagePersistedIntent {
    func encode(to encoder: Encoder) throws { try raw.encode(to: encoder) }
    func parameters() throws -> ApplicationDocumentJSON { try validate(); return .object(["p_intent": try raw]) }
    func recoveryParameters() throws -> ApplicationDocumentJSON {
        try validate(); return .object(["p_operation": .string(Self.operation.rawValue), "p_intent": try raw])
    }
}

struct ApplicationPackageSubmitIntent: ApplicationPackagePersistedIntent, ApplicationPackageRawDecodable {
    static let operation = ApplicationPackageOperation.submit
    let studentCaseId: String, applicationId: String, requirementsRevisionId: String, requestId: String
    let expectedPreviousPackageId: String?
    let items: [ApplicationPackageSelectionItem]
    var recoveryTargetId: String { applicationId }
    init(studentCaseId: String, applicationId: String, requirementsRevisionId: String, expectedPreviousPackageId: String?,
         items: [ApplicationPackageSelectionItem], requestId: String) throws {
        self.studentCaseId = studentCaseId; self.applicationId = applicationId; self.requirementsRevisionId = requirementsRevisionId
        self.expectedPreviousPackageId = expectedPreviousPackageId; self.items = items; self.requestId = requestId; try validate()
    }
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("studentCaseId applicationId requirementsRevisionId expectedPreviousPackageId items requestId")
        try self.init(studentCaseId: r[p: "studentCaseId"].uuid(), applicationId: r[p: "applicationId"].uuid(),
            requirementsRevisionId: r[p: "requirementsRevisionId"].uuid(), expectedPreviousPackageId: r[p: "expectedPreviousPackageId"].optional { try $0.uuid() },
            items: ApplicationPackageWire.array(r[p: "items"], minimum: 1).map(ApplicationPackageSelectionItem.init), requestId: r[p: "requestId"].uuid())
    }
    func validate() throws {
        try ApplicationPackageWire.require([studentCaseId, applicationId, requirementsRevisionId, requestId].allSatisfy(ApplicationDocumentWire.uuid)
            && (expectedPreviousPackageId.map(ApplicationDocumentWire.uuid) ?? true) && (1...100).contains(items.count))
        try ApplicationPackageWire.unique(items.map(\.requirementItemId)); for item in items { try item.validate() }
    }
    var raw: ApplicationDocumentJSON { get throws {
        .object(["studentCaseId": .string(studentCaseId), "applicationId": .string(applicationId), "requirementsRevisionId": .string(requirementsRevisionId),
                 "expectedPreviousPackageId": ApplicationPackageWire.nullable(expectedPreviousPackageId), "items": .array(try items.map { try $0.raw }), "requestId": .string(requestId)])
    } }
}

struct ApplicationPackageReviewIntent: ApplicationPackagePersistedIntent, ApplicationPackageRawDecodable {
    static let operation = ApplicationPackageOperation.review
    let studentCaseId: String, applicationId: String, packageId: String, requestId: String
    let expectedPreviousReviewId: String?, decision: ApplicationPackageDecision, reason: String?
    let affectedItemIds: [String], documentReviews: [ApplicationPackageDocumentExpectation], reuseApprovals: [ApplicationPackageReuseApproval]
    var recoveryTargetId: String { packageId }
    init(studentCaseId: String, applicationId: String, packageId: String, expectedPreviousReviewId: String?, decision: ApplicationPackageDecision,
         reason: String?, affectedItemIds: [String], documentReviews: [ApplicationPackageDocumentExpectation], reuseApprovals: [ApplicationPackageReuseApproval], requestId: String) throws {
        self.studentCaseId = studentCaseId; self.applicationId = applicationId; self.packageId = packageId; self.expectedPreviousReviewId = expectedPreviousReviewId
        self.decision = decision; self.reason = reason; self.affectedItemIds = affectedItemIds; self.documentReviews = documentReviews; self.reuseApprovals = reuseApprovals; self.requestId = requestId
        try validate()
    }
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("studentCaseId applicationId packageId expectedPreviousReviewId decision reason affectedItemIds documentReviews reuseApprovals requestId")
        try self.init(studentCaseId: r[p: "studentCaseId"].uuid(), applicationId: r[p: "applicationId"].uuid(), packageId: r[p: "packageId"].uuid(),
            expectedPreviousReviewId: r[p: "expectedPreviousReviewId"].optional { try $0.uuid() }, decision: r[p: "decision"].decode(ApplicationPackageDecision.self),
            reason: r[p: "reason"].optional { try $0.text(5000) }, affectedItemIds: ApplicationPackageWire.ids(r[p: "affectedItemIds"]),
            documentReviews: ApplicationPackageWire.array(r[p: "documentReviews"], minimum: 1).map(ApplicationPackageDocumentExpectation.init),
            reuseApprovals: ApplicationPackageWire.array(r[p: "reuseApprovals"]).map(ApplicationPackageReuseApproval.init), requestId: r[p: "requestId"].uuid())
    }
    func validate() throws {
        try ApplicationPackageWire.require([studentCaseId, applicationId, packageId, requestId].allSatisfy(ApplicationDocumentWire.uuid)
            && (expectedPreviousReviewId.map(ApplicationDocumentWire.uuid) ?? true) && (1...100).contains(documentReviews.count)
            && affectedItemIds.count <= 100 && affectedItemIds.allSatisfy(ApplicationDocumentWire.uuid) && reuseApprovals.count <= 100)
        _ = try ApplicationPackageWire.reason(ApplicationPackageWire.nullable(reason), decision: decision, affected: affectedItemIds)
        try ApplicationPackageWire.unique(affectedItemIds); try ApplicationPackageWire.unique(documentReviews.map(\.requirementItemId))
        try ApplicationPackageWire.unique(documentReviews.map(\.submissionId)); try ApplicationPackageWire.unique(reuseApprovals.map { $0.expectation.requirementItemId })
        try ApplicationPackageWire.require(Set(affectedItemIds).isSubset(of: Set(documentReviews.map(\.requirementItemId))) && (decision == .approved || reuseApprovals.isEmpty))
        for value in documentReviews { try value.validate() }
        for value in reuseApprovals { try value.validate(); try ApplicationPackageWire.require(documentReviews.contains(value.expectation)) }
    }
    var raw: ApplicationDocumentJSON { get throws {
        .object(["studentCaseId": .string(studentCaseId), "applicationId": .string(applicationId), "packageId": .string(packageId), "requestId": .string(requestId),
            "expectedPreviousReviewId": ApplicationPackageWire.nullable(expectedPreviousReviewId), "decision": .string(decision.rawValue), "reason": ApplicationPackageWire.nullable(reason),
            "affectedItemIds": .array(affectedItemIds.map(ApplicationDocumentJSON.string)), "documentReviews": .array(documentReviews.map(\.raw)), "reuseApprovals": .array(reuseApprovals.map(\.raw))])
    } }
}

struct ApplicationPackageReviewEvidence: ApplicationPackageRawDecodable {
    let requirementItemId: String, submissionId: String, review: ApplicationDocumentReview?
    let reusedFromSubmissionId: String?, reusedFromReview: ApplicationDocumentReview?
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("requirementItemId submissionId review reusedFromSubmissionId reusedFromReview")
        requirementItemId = try r[p: "requirementItemId"].uuid(); submissionId = try r[p: "submissionId"].uuid()
        review = try r[p: "review"].optional(ApplicationDocumentReview.init)
        reusedFromSubmissionId = try r[p: "reusedFromSubmissionId"].optional { try $0.uuid() }; reusedFromReview = try r[p: "reusedFromReview"].optional(ApplicationDocumentReview.init)
        try ApplicationPackageWire.require((reusedFromSubmissionId == nil) == (reusedFromReview == nil))
        if let reusedFromReview { try ApplicationPackageWire.require(reusedFromReview.decision == .approved && review?.decision == .approved && reusedFromSubmissionId != submissionId) }
    }
}
struct ApplicationPackageReview: ApplicationPackageRawDecodable {
    let packageReviewId: String, packageId: String, decision: ApplicationPackageDecision, reason: String?, reviewedAt: String
    let affectedItemIds: [String], documentReviews: [ApplicationPackageReviewEvidence]
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("packageReviewId packageId decision reason affectedItemIds documentReviews reviewedAt")
        packageReviewId = try r[p: "packageReviewId"].uuid(); packageId = try r[p: "packageId"].uuid()
        decision = try r[p: "decision"].decode(ApplicationPackageDecision.self); affectedItemIds = try ApplicationPackageWire.ids(r[p: "affectedItemIds"])
        reason = try ApplicationPackageWire.reason(r[p: "reason"], decision: decision, affected: affectedItemIds)
        documentReviews = try ApplicationPackageWire.array(r[p: "documentReviews"], minimum: 1).map(ApplicationPackageReviewEvidence.init)
        reviewedAt = try r[p: "reviewedAt"].timestamp()
        try ApplicationPackageWire.unique(documentReviews.map(\.requirementItemId)); try ApplicationPackageWire.unique(documentReviews.map(\.submissionId))
        try ApplicationPackageWire.require(Set(affectedItemIds).isSubset(of: Set(documentReviews.map(\.requirementItemId))))
        if decision == .approved { try ApplicationPackageWire.require(documentReviews.allSatisfy { $0.review?.decision == .approved }) }
        else { try ApplicationPackageWire.require(documentReviews.allSatisfy { $0.reusedFromReview == nil }) }
    }
}
struct ApplicationPackageSummary: ApplicationPackageRawDecodable, Identifiable {
    var id: String { packageId }
    let packageId: String, requirementsRevisionId: String, requirementsRevisionVersion: String, packageVersion: String
    let origin: ApplicationRequirementsV2Origin, configurationState: ApplicationRequirementsV2Configuration
    let previousPackageId: String?, compositionSha256: String, submittedAt: String, itemCount: Int, isCurrentRequirements: Bool
    let latestReview: ApplicationPackageReview?
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("packageId requirementsRevisionId requirementsRevisionVersion origin configurationState packageVersion previousPackageId compositionSha256 submittedAt itemCount isCurrentRequirements latestReview")
        packageId = try r[p: "packageId"].uuid(); requirementsRevisionId = try r[p: "requirementsRevisionId"].uuid()
        requirementsRevisionVersion = try r[p: "requirementsRevisionVersion"].version(); packageVersion = try r[p: "packageVersion"].version()
        origin = try r[p: "origin"].decode(ApplicationRequirementsV2Origin.self); configurationState = try r[p: "configurationState"].decode(ApplicationRequirementsV2Configuration.self)
        previousPackageId = try r[p: "previousPackageId"].optional { try $0.uuid() }; compositionSha256 = try ApplicationPackageWire.hash(r[p: "compositionSha256"])
        submittedAt = try r[p: "submittedAt"].timestamp(); isCurrentRequirements = try r[p: "isCurrentRequirements"].boolean()
        guard case .integer(let count) = r[p: "itemCount"] else { throw ApplicationPackageClientError.invalidResponse }; itemCount = count
        latestReview = try r[p: "latestReview"].optional(ApplicationPackageReview.init)
        try ApplicationPackageWire.require((1...100).contains(count) && previousPackageId != packageId &&
            ((origin == .evoStarter && configurationState == .needsConfirmation) || (origin == .staffConfirmed && configurationState == .confirmed)))
        if let latestReview { try ApplicationPackageWire.require(latestReview.packageId == packageId && latestReview.documentReviews.count == itemCount) }
    }
}
struct ApplicationPackageProgram: ApplicationPackageRawDecodable {
    let institutionId: String, publicationId: String, programId: String, intakeId: String
    let universityTitle: String, programTitle: String, intakeLabel: String
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("institutionId publicationId programId intakeId universityTitle programTitle intakeLabel")
        institutionId = try r[p: "institutionId"].uuid(); publicationId = try r[p: "publicationId"].uuid()
        programId = try r[p: "programId"].text(64); intakeId = try r[p: "intakeId"].uuid()
        try ApplicationPackageWire.require(ApplicationDocumentWire.matches(programId, "^[a-z0-9][a-z0-9-]*$"))
        universityTitle = try r[p: "universityTitle"].text(1000); programTitle = try r[p: "programTitle"].text(1000); intakeLabel = try r[p: "intakeLabel"].text(1000)
    }
}
struct ApplicationPackageItem: ApplicationPackageRawDecodable, Identifiable {
    var id: String { packageItemId }
    let packageItemId: String, requirementItemId: String, definition: ApplicationDocumentDefinition
    let materialSnapshot: ApplicationDocumentMaterialSnapshot?, selection: ApplicationDocumentSelection, submission: ApplicationDocumentSubmission
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("packageItemId requirementItemId definition materialSnapshot selection submission")
        packageItemId = try r[p: "packageItemId"].uuid(); requirementItemId = try r[p: "requirementItemId"].uuid()
        definition = try ApplicationDocumentDefinition(r[p: "definition"]); materialSnapshot = try r[p: "materialSnapshot"].optional(ApplicationDocumentMaterialSnapshot.init)
        selection = try ApplicationPackageWire.selection(r[p: "selection"]); submission = try ApplicationDocumentSubmission(r[p: "submission"])
        try ApplicationPackageWire.require(submission.requirementItemId == requirementItemId && submission.documentSlotId == definition.documentSlotId && submission.file.id == selection.documentVersionId)
    }
}
struct ApplicationPackageCurrentWarning: ApplicationPackageRawDecodable {
    let requirementItemId: String, submissionId: String, reason: ApplicationPackageWarningReason, currentReview: ApplicationDocumentReview?
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("requirementItemId submissionId reason currentReview")
        requirementItemId = try r[p: "requirementItemId"].uuid(); submissionId = try r[p: "submissionId"].uuid()
        reason = try r[p: "reason"].decode(ApplicationPackageWarningReason.self); currentReview = try r[p: "currentReview"].optional(ApplicationDocumentReview.init)
    }
}

protocol ApplicationPackageScoped {
    var studentCaseId: String { get }
    var applicationId: String { get }
}
extension ApplicationPackageScoped {
    func validate(studentCaseId: String, applicationId: String) throws {
        try ApplicationPackageWire.require(self.studentCaseId == studentCaseId && self.applicationId == applicationId)
    }
}
struct ApplicationPackageDetail: ApplicationPackageRawDecodable, ApplicationPackageScoped {
    let studentCaseId: String, applicationId: String, package: ApplicationPackageSummary, program: ApplicationPackageProgram
    let items: [ApplicationPackageItem], currentWarnings: [ApplicationPackageCurrentWarning]
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("protocolVersion studentCaseId applicationId package program items currentWarnings")
        try ApplicationPackageWire.require(r[p: "protocolVersion"] == .integer(1))
        studentCaseId = try r[p: "studentCaseId"].uuid(); applicationId = try r[p: "applicationId"].uuid()
        package = try ApplicationPackageSummary(r[p: "package"]); program = try ApplicationPackageProgram(r[p: "program"])
        items = try ApplicationPackageWire.array(r[p: "items"], minimum: 1).map(ApplicationPackageItem.init)
        currentWarnings = try ApplicationPackageWire.array(r[p: "currentWarnings"], maximum: 200).map(ApplicationPackageCurrentWarning.init)
        try ApplicationPackageWire.unique(items.map(\.id)); try ApplicationPackageWire.unique(items.map(\.requirementItemId)); try ApplicationPackageWire.unique(items.map { $0.submission.submissionId })
        try ApplicationPackageWire.require(items.count == package.itemCount && items.allSatisfy { $0.submission.requirementsRevisionId == package.requirementsRevisionId })
        if let review = package.latestReview {
            for (item, evidence) in zip(items, review.documentReviews) {
                try ApplicationPackageWire.require(item.requirementItemId == evidence.requirementItemId && item.submission.submissionId == evidence.submissionId)
            }
        }
        try ApplicationPackageWire.unique(currentWarnings.map { $0.requirementItemId + "/" + $0.reason.rawValue })
        for warning in currentWarnings {
            guard let item = items.first(where: { $0.requirementItemId == warning.requirementItemId }) else { throw ApplicationPackageClientError.invalidResponse }
            try ApplicationPackageWire.require(warning.submissionId == item.submission.submissionId && ApplicationPackageWire.sameReview(warning.currentReview, item.submission.review))
            if warning.reason == .fileUnavailable { try ApplicationPackageWire.require(item.submission.file.technicalAvailability != .available) }
            if warning.reason == .reviewChanged {
                guard let review = package.latestReview else { throw ApplicationPackageClientError.invalidResponse }
                try ApplicationPackageWire.require(review.documentReviews.first { $0.requirementItemId == warning.requirementItemId }?.review?.reviewId != warning.currentReview?.reviewId)
            }
        }
        let expectedWarnings = items.reduce(0) { count, item in
            let changedReview = package.latestReview.map { review in
                review.documentReviews.first { $0.requirementItemId == item.requirementItemId }?.review?.reviewId != item.submission.review?.reviewId
            } ?? false
            return count + (item.submission.file.technicalAvailability == .available ? 0 : 1) + (changedReview ? 1 : 0)
        }
        try ApplicationPackageWire.require(currentWarnings.count == expectedWarnings)
    }
    func validate(studentCaseId: String, applicationId: String, packageId: String) throws {
        try validate(studentCaseId: studentCaseId, applicationId: applicationId)
        try ApplicationPackageWire.require(package.packageId == packageId)
    }
}

struct ApplicationPackageReadinessSelection: ApplicationPackageRawDecodable {
    let item: ApplicationPackageSelectionItem, file: ApplicationDocumentFileSummary?, submissionId: String?, reasons: [ApplicationPackageReadyReason]
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("requirementItemId selection expectedPreviousSubmissionId file submissionId reasons")
        item = try ApplicationPackageSelectionItem(.object(r.filter { ["requirementItemId", "selection", "expectedPreviousSubmissionId"].contains($0.key) }))
        file = try r[p: "file"].optional(ApplicationDocumentFileSummary.init); submissionId = try r[p: "submissionId"].optional { try $0.uuid() }
        reasons = try r[p: "reasons"].decode([ApplicationPackageReadyReason].self); try ApplicationPackageWire.unique(reasons.map(\.rawValue))
        if let file { try ApplicationPackageWire.require(file.id == item.selection.documentVersionId) }
    }
}
struct ApplicationPackageReadiness: ApplicationPackageRawDecodable, ApplicationPackageScoped {
    let studentCaseId: String, applicationId: String, requirements: ApplicationRequirementsV2View
    let documentItems: [ApplicationDocumentItem], latestPackage: ApplicationPackageSummary?, selections: [ApplicationPackageReadinessSelection]
    let missingRequiredItemIds: [String], reasons: [ApplicationPackageReadyReason], canSubmit: Bool
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("protocolVersion studentCaseId applicationId requirements documentItems latestPackage selections missingRequiredItemIds reasons canSubmit")
        try ApplicationPackageWire.require(r[p: "protocolVersion"] == .integer(1))
        studentCaseId = try r[p: "studentCaseId"].uuid(); applicationId = try r[p: "applicationId"].uuid()
        requirements = try r[p: "requirements"].decode(ApplicationRequirementsV2View.self)
        try requirements.validate(studentCaseId: UUID(uuidString: studentCaseId)!, applicationId: UUID(uuidString: applicationId)!)
        documentItems = try ApplicationPackageWire.array(r[p: "documentItems"]).map(ApplicationDocumentItem.init)
        latestPackage = try r[p: "latestPackage"].optional(ApplicationPackageSummary.init)
        selections = try ApplicationPackageWire.array(r[p: "selections"]).map(ApplicationPackageReadinessSelection.init)
        missingRequiredItemIds = try ApplicationPackageWire.ids(r[p: "missingRequiredItemIds"])
        reasons = try r[p: "reasons"].decode([ApplicationPackageReadyReason].self); try ApplicationPackageWire.unique(reasons.map(\.rawValue))
        canSubmit = try r[p: "canSubmit"].boolean()
        try ApplicationPackageWire.require(documentItems.count == requirements.items.count)
        let revision = requirements.revision?.revisionId.uuidString.lowercased()
        for (document, requirement) in zip(documentItems, requirements.items) {
            try ApplicationPackageWire.require(document.id == requirement.id.uuidString.lowercased() && document.documentSlotId == requirement.documentSlotId.uuidString.lowercased())
            if let draft = document.savedDraft { try ApplicationPackageWire.require(draft.requirementItemId == document.id && draft.documentSlotId == document.documentSlotId && draft.requirementsRevisionId == revision) }
            if let submitted = document.submission { try ApplicationPackageWire.require(submitted.requirementItemId == document.id && submitted.documentSlotId == document.documentSlotId && submitted.requirementsRevisionId == revision) }
            if let old = document.previousEvidence { try ApplicationPackageWire.require(old.requirementItemId != document.id) }
        }
        try ApplicationPackageWire.unique(selections.map { $0.item.requirementItemId })
        let required = Set(requirements.items.filter(\.required).map { $0.id.uuidString.lowercased() })
        let selected = Set(selections.map { $0.item.requirementItemId })
        try ApplicationPackageWire.require(selected.isSubset(of: Set(documentItems.map(\.id))) && Set(missingRequiredItemIds) == required.subtracting(selected))
        if canSubmit { try ApplicationPackageWire.require(revision != nil && reasons.isEmpty && missingRequiredItemIds.isEmpty && !selections.isEmpty && selections.allSatisfy { $0.reasons.isEmpty && $0.file?.technicalAvailability == .available }) }
        if let latestPackage { try ApplicationPackageWire.require(latestPackage.isCurrentRequirements == (latestPackage.requirementsRevisionId == revision)) }
    }
}

struct ApplicationPackageHistory: ApplicationPackageRawDecodable, ApplicationPackageScoped {
    let studentCaseId: String, applicationId: String, packages: [ApplicationPackageSummary], nextCursor: ApplicationDocumentHistoryCursor?
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("protocolVersion studentCaseId applicationId packages nextCursor")
        try ApplicationPackageWire.require(r[p: "protocolVersion"] == .integer(1)); studentCaseId = try r[p: "studentCaseId"].uuid(); applicationId = try r[p: "applicationId"].uuid()
        packages = try ApplicationPackageWire.array(r[p: "packages"], maximum: 50).map(ApplicationPackageSummary.init)
        nextCursor = try r[p: "nextCursor"].optional(ApplicationDocumentHistoryCursor.init)
        try ApplicationPackageWire.page(packages.map { ($0.submittedAt, $0.packageId) }, cursor: nextCursor)
    }
}
struct ApplicationPackageReviewHistory: ApplicationPackageRawDecodable, ApplicationPackageScoped {
    let studentCaseId: String, applicationId: String, packageId: String, reviews: [ApplicationPackageReview], nextCursor: ApplicationDocumentHistoryCursor?
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("protocolVersion studentCaseId applicationId packageId reviews nextCursor")
        try ApplicationPackageWire.require(r[p: "protocolVersion"] == .integer(1)); studentCaseId = try r[p: "studentCaseId"].uuid(); applicationId = try r[p: "applicationId"].uuid(); packageId = try r[p: "packageId"].uuid()
        reviews = try ApplicationPackageWire.array(r[p: "reviews"], maximum: 50).map(ApplicationPackageReview.init)
        nextCursor = try r[p: "nextCursor"].optional(ApplicationDocumentHistoryCursor.init)
        try ApplicationPackageWire.require(reviews.allSatisfy { $0.packageId == packageId })
        try ApplicationPackageWire.page(reviews.map { ($0.reviewedAt, $0.packageReviewId) }, cursor: nextCursor)
    }
    func validate(studentCaseId: String, applicationId: String, packageId: String) throws {
        try validate(studentCaseId: studentCaseId, applicationId: applicationId)
        try ApplicationPackageWire.require(self.packageId == packageId)
    }
}
struct ApplicationPackageQueueItem: ApplicationPackageRawDecodable, ApplicationPackageScoped {
    let studentCaseId: String, applicationId: String, studentDisplayName: String, program: ApplicationPackageProgram, package: ApplicationPackageSummary
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("studentCaseId applicationId studentDisplayName program package")
        studentCaseId = try r[p: "studentCaseId"].uuid(); applicationId = try r[p: "applicationId"].uuid(); studentDisplayName = try r[p: "studentDisplayName"].text(500)
        program = try ApplicationPackageProgram(r[p: "program"]); package = try ApplicationPackageSummary(r[p: "package"])
    }
}
struct ApplicationPackageQueue: ApplicationPackageRawDecodable {
    let items: [ApplicationPackageQueueItem], nextCursor: ApplicationDocumentHistoryCursor?
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("protocolVersion items nextCursor"); try ApplicationPackageWire.require(r[p: "protocolVersion"] == .integer(1))
        items = try ApplicationPackageWire.array(r[p: "items"], maximum: 50).map(ApplicationPackageQueueItem.init); nextCursor = try r[p: "nextCursor"].optional(ApplicationDocumentHistoryCursor.init)
        try ApplicationPackageWire.page(items.map { ($0.package.submittedAt, $0.package.packageId) }, cursor: nextCursor)
    }
}
struct ApplicationPackageNotification: ApplicationPackageRawDecodable, ApplicationPackageScoped {
    let notificationId: String, studentCaseId: String, applicationId: String, packageId: String, packageReviewId: String, review: ApplicationPackageReview
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("protocolVersion notificationId studentCaseId applicationId packageId packageReviewId review")
        try ApplicationPackageWire.require(r[p: "protocolVersion"] == .integer(1)); notificationId = try r[p: "notificationId"].uuid()
        studentCaseId = try r[p: "studentCaseId"].uuid(); applicationId = try r[p: "applicationId"].uuid(); packageId = try r[p: "packageId"].uuid(); packageReviewId = try r[p: "packageReviewId"].uuid()
        review = try ApplicationPackageReview(r[p: "review"]); try ApplicationPackageWire.require(review.packageId == packageId && review.packageReviewId == packageReviewId)
    }
    func validate(notificationId: String, studentCaseId: String) throws {
        try ApplicationPackageWire.require(self.notificationId == notificationId && self.studentCaseId == studentCaseId)
    }
}

struct ApplicationPackageSubmitReceiptItem: ApplicationPackageRawDecodable {
    let packageItemId: String, requirementItemId: String, documentSlotId: String, documentVersionId: String, submissionId: String
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("packageItemId requirementItemId documentSlotId documentVersionId submissionId")
        packageItemId = try r[p: "packageItemId"].uuid(); requirementItemId = try r[p: "requirementItemId"].uuid(); documentSlotId = try r[p: "documentSlotId"].uuid()
        documentVersionId = try r[p: "documentVersionId"].uuid(); submissionId = try r[p: "submissionId"].uuid()
    }
}
struct ApplicationPackageSubmitReceipt: ApplicationPackageRawDecodable, ApplicationPackageScoped {
    let requestId: String, studentCaseId: String, applicationId: String, packageId: String, requirementsRevisionId: String
    let packageVersion: String, compositionSha256: String, submittedAt: String, reused: Bool, items: [ApplicationPackageSubmitReceiptItem]
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("protocolVersion requestId studentCaseId applicationId packageId requirementsRevisionId packageVersion compositionSha256 submittedAt reused items")
        try ApplicationPackageWire.require(r[p: "protocolVersion"] == .integer(1)); requestId = try r[p: "requestId"].uuid()
        studentCaseId = try r[p: "studentCaseId"].uuid(); applicationId = try r[p: "applicationId"].uuid(); packageId = try r[p: "packageId"].uuid(); requirementsRevisionId = try r[p: "requirementsRevisionId"].uuid()
        packageVersion = try r[p: "packageVersion"].version(); compositionSha256 = try ApplicationPackageWire.hash(r[p: "compositionSha256"]); submittedAt = try r[p: "submittedAt"].timestamp(); reused = try r[p: "reused"].boolean()
        items = try ApplicationPackageWire.array(r[p: "items"], minimum: 1).map(ApplicationPackageSubmitReceiptItem.init)
        try ApplicationPackageWire.unique(items.map(\.packageItemId)); try ApplicationPackageWire.unique(items.map(\.requirementItemId)); try ApplicationPackageWire.unique(items.map(\.submissionId))
    }
    func validate(_ intent: ApplicationPackageSubmitIntent) throws {
        try intent.validate(); try validate(studentCaseId: intent.studentCaseId, applicationId: intent.applicationId)
        try ApplicationPackageWire.require(requestId == intent.requestId && requirementsRevisionId == intent.requirementsRevisionId && items.count == intent.items.count)
        for (received, expected) in zip(items, intent.items) { try ApplicationPackageWire.require(received.requirementItemId == expected.requirementItemId && received.documentVersionId == expected.selection.documentVersionId) }
    }
}
struct ApplicationPackageReviewReceipt: ApplicationPackageRawDecodable, ApplicationPackageScoped {
    let requestId: String, studentCaseId: String, applicationId: String, packageId: String, packageReview: ApplicationPackageReview
    init(_ raw: ApplicationDocumentJSON) throws {
        let r = try raw.object("protocolVersion requestId studentCaseId applicationId packageId packageReview")
        try ApplicationPackageWire.require(r[p: "protocolVersion"] == .integer(1)); requestId = try r[p: "requestId"].uuid()
        studentCaseId = try r[p: "studentCaseId"].uuid(); applicationId = try r[p: "applicationId"].uuid(); packageId = try r[p: "packageId"].uuid()
        packageReview = try ApplicationPackageReview(r[p: "packageReview"]); try ApplicationPackageWire.require(packageReview.packageId == packageId)
    }
    func validate(_ intent: ApplicationPackageReviewIntent) throws {
        try intent.validate(); try validate(studentCaseId: intent.studentCaseId, applicationId: intent.applicationId)
        try ApplicationPackageWire.require(requestId == intent.requestId && packageId == intent.packageId && packageReview.decision == intent.decision
            && packageReview.reason == intent.reason && packageReview.affectedItemIds == intent.affectedItemIds && packageReview.documentReviews.count == intent.documentReviews.count)
        for (actual, expected) in zip(packageReview.documentReviews, intent.documentReviews) {
            try ApplicationPackageWire.require(actual.requirementItemId == expected.requirementItemId && actual.submissionId == expected.submissionId)
            if let reuse = intent.reuseApprovals.first(where: { $0.expectation == expected }) {
                try ApplicationPackageWire.require(actual.reusedFromSubmissionId == reuse.sourceSubmissionId && actual.reusedFromReview?.reviewId == reuse.sourceReviewId && actual.review?.decision == .approved)
                if let expectedReviewId = expected.expectedReviewId { try ApplicationPackageWire.require(actual.review?.reviewId == expectedReviewId) }
            } else { try ApplicationPackageWire.require(actual.review?.reviewId == expected.expectedReviewId && actual.reusedFromReview == nil && actual.reusedFromSubmissionId == nil) }
        }
    }
}

enum ApplicationPackageRecovery {
    case submit(ApplicationPackageSubmitReceipt), review(ApplicationPackageReviewReceipt), notWritten(ApplicationPackageOperation)
    static func decode(_ data: Data, intent: ApplicationPackageSubmitIntent) throws -> Self {
        let r = try envelope(data, intent: intent)
        if r[p: "status"] == .string("not_written") { return .notWritten(.submit) }
        let receipt = try ApplicationPackageSubmitReceipt(r[p: "receipt"]); try receipt.validate(intent); return .submit(receipt)
    }
    static func decode(_ data: Data, intent: ApplicationPackageReviewIntent) throws -> Self {
        let r = try envelope(data, intent: intent)
        if r[p: "status"] == .string("not_written") { return .notWritten(.review) }
        let receipt = try ApplicationPackageReviewReceipt(r[p: "receipt"]); try receipt.validate(intent); return .review(receipt)
    }
    private static func envelope<Intent: ApplicationPackagePersistedIntent>(_ data: Data, intent: Intent) throws -> [String: ApplicationDocumentJSON] {
        try intent.validate()
        let r = try JSONDecoder().decode(ApplicationDocumentJSON.self, from: data).object("protocolVersion operation requestId studentCaseId applicationId status receipt")
        try ApplicationPackageWire.require(r[p: "protocolVersion"] == .integer(1) && r[p: "operation"] == .string(Intent.operation.rawValue)
            && r[p: "requestId"] == .string(intent.requestId) && r[p: "studentCaseId"] == .string(intent.studentCaseId) && r[p: "applicationId"] == .string(intent.applicationId))
        let status = try r[p: "status"].string()
        try ApplicationPackageWire.require((status == "not_written" && r[p: "receipt"] == .null) || (status == "committed" && r[p: "receipt"] != .null))
        return r
    }
}
