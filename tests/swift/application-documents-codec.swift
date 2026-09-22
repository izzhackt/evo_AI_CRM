import Foundation

/// Offline protocol and durable-intent checks. Constructed values below are
/// deliberately codec inputs; they are not actual uploads, review or UI proof.
@main struct ApplicationDocumentsCodecChecks {
    enum Failure: Error { case check(String) }
    static var count = 0
    static func check(_ condition: @autoclosure () throws -> Bool, _ name: String) throws {
        count += 1
        guard try condition() else { throw Failure.check(name) }
    }
    static func rejects(_ name: String, _ action: () throws -> Void) throws {
        count += 1
        do { try action() } catch { return }
        throw Failure.check(name)
    }
    static func data(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }
    static func json(_ value: Any) throws -> ApplicationDocumentJSON { try JSONDecoder().decode(ApplicationDocumentJSON.self, from: data(value)) }
    static func main() throws {
        do { try run() } catch {
            FileHandle.standardError.write(Data("Failure after \(count) checks: \(error)\n".utf8))
            exit(1)
        }
    }
    static func run() throws {
        let caseId = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let appId = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let revision = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let item = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!
        let slot = UUID(uuidString: "55555555-5555-4555-8555-555555555555")!
        let request = "66666666-6666-4666-8666-666666666666"
        let version = "77777777-7777-4777-8777-777777777777"
        let upload = "88888888-8888-4888-8888-888888888888"
        let bytes = Data("offline protocol bytes".utf8)
        let file = try ApplicationDocumentFile(originalFilename: "паспорт.pdf", declaredMimeType: "application/pdf", data: bytes)
        let intent = try ApplicationDocumentUploadIntent(studentCaseId: caseId, applicationId: appId, requirementsRevisionId: revision,
            requirementItemId: item, documentSlotId: slot, file: file)
        let header = try intent.headerValue()
        try check(!header.contains("="), "unpadded header")
        let raw = header.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let headerBytes = Data(base64Encoded: raw + String(repeating: "=", count: (4 - raw.count % 4) % 4))!
        let object = try JSONSerialization.jsonObject(with: headerBytes) as! [String: Any]
        try check(Set(object.keys) == Set(["protocolVersion", "studentCaseId", "applicationId", "requirementsRevisionId", "requirementItemId", "documentSlotId", "file"]), "header exact keys")
        try check(try JSONDecoder().decode(ApplicationDocumentUploadIntent.self, from: headerBytes) == intent, "header exact roundtrip")
        let transport = try ApplicationDocumentTransfer.uploadRequest(baseURL: URL(string: "https://example.org")!, intent: intent,
            requestId: request, accessToken: "offline-test-token", fileData: bytes, boundary: "codec-boundary")
        try check(transport.value(forHTTPHeaderField: "Idempotency-Key") == request, "request identity")
        try check(String(data: transport.httpBody!, encoding: .utf8)!.contains("filename=\"upload\""), "literal transport filename")
        try rejects("changed bytes") { _ = try ApplicationDocumentTransfer.uploadRequest(baseURL: URL(string: "https://example.org")!, intent: intent,
            requestId: request, accessToken: "offline-test-token", fileData: Data("changed".utf8), boundary: "codec-boundary") }
        for name in ["../passport.pdf", " passport.pdf", "passport\u{0085}.pdf", String(repeating: "a", count: 256)] {
            try rejects("unsafe filename") { _ = try ApplicationDocumentFile(originalFilename: name, declaredMimeType: "application/pdf", data: bytes) }
        }
        var fileJSON: [String: Any] = ["originalFilename": file.originalFilename, "declaredMimeType": file.declaredMimeType,
            "byteSize": file.byteSize, "sha256Hex": file.sha256Hex, "documentVersionId": version, "versionNo": "9007199254740993",
            "finalizedAt": "2026-09-21T12:00:00.123456+00:00", "technicalAvailability": "available", "unavailableReasons": []]
        for legacyName in ["../passport.pdf", "folder\\passport.pdf", "\u{00A0}passport.pdf\u{00A0}"] {
            var legacy = fileJSON; legacy["originalFilename"] = legacyName
            let decoded = try ApplicationDocumentFileSummary(json(legacy))
            try check(decoded.file.originalFilename == legacyName && decoded.file.previewFilename == "document.pdf", "legacy name is display only")
            try rejects("legacy filename cannot enter new upload") { try decoded.file.validate() }
        }
        let summary = try ApplicationDocumentFileSummary(json(fileJSON))
        try check(summary.versionNo == "9007199254740993", "version preserves above JS safe integer")
        for badVersion: Any in [1, "0", "01", "9223372036854775808"] {
            var bad = fileJSON; bad["versionNo"] = badVersion
            try rejects("invalid decimal version") { _ = try ApplicationDocumentFileSummary(json(bad)) }
        }
        for invalidDate in ["2026-02-30T12:00:00Z", "2026-09-21T25:00:00Z", "2026-09-21T12:00:00.1234567Z"] {
            var bad = fileJSON; bad["finalizedAt"] = invalidDate
            try rejects("invalid timestamp") { _ = try ApplicationDocumentFileSummary(json(bad)) }
        }
        fileJSON["technicalAvailability"] = "unavailable"; fileJSON["unavailableReasons"] = ["storage_object_unavailable"]
        try check(try ApplicationDocumentFileSummary(json(fileJSON)).unavailableReasons.count == 1, "storage reason")
        fileJSON["unavailableReasons"] = ["malware_pending", "malware_error"]
        try rejects("contradictory scan states") { _ = try ApplicationDocumentFileSummary(json(fileJSON)) }
        fileJSON["technicalAvailability"] = "available"; fileJSON["unavailableReasons"] = []
        let draft: [String: Any] = ["uploadContextId": upload, "requirementsRevisionId": revision.uuidString.lowercased(),
            "requirementItemId": item.uuidString.lowercased(), "documentSlotId": slot.uuidString.lowercased(),
            "admittedAt": "2026-09-21T11:59:59Z", "file": fileJSON]
        let definition: [String: Any] = ["requirementKey": "evo.passport.v1", "required": true, "label": "Паспорт", "groupLabel": "Документы",
            "instructions": "", "deadline": NSNull(), "documentSlotId": slot.uuidString.lowercased()]
        let event: [String: Any] = ["id": upload, "kind": "upload", "createdAt": "2026-09-21T11:59:59Z",
            "requirementsRevisionId": revision.uuidString.lowercased(), "requirementItemId": item.uuidString.lowercased(),
            "definition": definition, "materialSnapshot": NSNull(), "upload": draft, "submission": NSNull()]
        let history = try ApplicationDocumentHistoryEntry(json(event))
        try check(history.file.id == version, "history retains exact version")
        let material: [String: Any] = ["intentKind": "baseline", "requirementId": request,
            "rawLabel": "Исходное имя", "rawGroupLabel": NSNull(), "label": "Паспорт", "groupLabel": "Основные документы",
            "sourceRequirementKey": "passport", "sourceChecklistVersion": "9007199254740993", "sourceInstructions": "Прежняя инструкция"]
        let deadline: [String: Any] = ["date": "2026-11-01", "time": "17:30", "timezone": "Asia/Bishkek",
            "verifiedOn": "2026-09-20", "sourceUrl": "https://university.edu/admissions"]
        var historicalDefinition = definition; historicalDefinition["required"] = false; historicalDefinition["deadline"] = deadline
        var snapshotEvent = event; snapshotEvent["materialSnapshot"] = material; snapshotEvent["definition"] = historicalDefinition
        let preserved = try ApplicationDocumentHistoryEntry(json(snapshotEvent))
        try check(preserved.materialSnapshot?.intentKind == .baseline && preserved.materialSnapshot?.requirementId == request,
                  "typed material identity retained")
        try check(preserved.materialSnapshot?.rawLabel == "Исходное имя" && preserved.materialSnapshot?.rawGroupLabel == nil
                  && preserved.materialSnapshot?.label == "Паспорт" && preserved.materialSnapshot?.groupLabel == "Основные документы",
                  "exact material presentation snapshot retained")
        try check(preserved.materialSnapshot?.sourceRequirementKey == "passport"
                  && preserved.materialSnapshot?.sourceChecklistVersion == "9007199254740993"
                  && preserved.materialSnapshot?.sourceInstructions == "Прежняя инструкция", "material provenance retained")
        try check(!preserved.definition.required && preserved.definition.groupLabel == "Документы"
                  && preserved.definition.deadline?.date == "2026-11-01" && preserved.definition.deadline?.time == "17:30"
                  && preserved.definition.deadline?.timezone == "Asia/Bishkek"
                  && preserved.definition.deadline?.verifiedOn == "2026-09-20"
                  && preserved.definition.deadline?.sourceUrl == "https://university.edu/admissions", "historical definition stays complete")
        var contradictory = material; contradictory["intentKind"] = "custom"
        try rejects("custom material cannot retain baseline source") { _ = try ApplicationDocumentMaterialSnapshot(json(contradictory)) }
        contradictory = material; contradictory["sourceChecklistVersion"] = NSNull()
        try rejects("baseline material needs source version") { _ = try ApplicationDocumentMaterialSnapshot(json(contradictory)) }
        var badEvent = event; badEvent["id"] = request
        try rejects("history payload mismatch") { _ = try ApplicationDocumentHistoryEntry(json(badEvent)) }
        var historyPage: [String: Any] = ["protocolVersion": 1, "studentCaseId": caseId.uuidString.lowercased(), "applicationId": appId.uuidString.lowercased(),
            "requirementItemId": NSNull(), "events": [event], "nextCursor": ["createdAt": "2026-09-21T11:59:59Z", "id": upload]]
        try check(try JSONDecoder().decode(ApplicationDocumentHistory.self, from: data(historyPage)).events.count == 1, "valid history cursor")
        historyPage["nextCursor"] = ["createdAt": "2026-09-21T11:59:59.000001Z", "id": upload]
        try rejects("microsecond cursor mismatch") { _ = try JSONDecoder().decode(ApplicationDocumentHistory.self, from: data(historyPage)) }
        var receipt = object; receipt["requestId"] = request; receipt["uploadContextId"] = upload
        receipt["documentVersionId"] = version; receipt["versionNo"] = "2"; receipt["finalizedAt"] = "2026-09-21T12:00:00Z"; receipt["publishedToLegacySlot"] = false
        _ = try ApplicationDocumentUploadReceipt.decodeEnvelope(data(["upload": receipt]), intent: intent, requestId: request)
        receipt["publishedToLegacySlot"] = true
        try rejects("legacy publication rejected") { _ = try ApplicationDocumentUploadReceipt.decodeEnvelope(data(["upload": receipt]), intent: intent, requestId: request) }
        let selection = ApplicationDocumentSelection(kind: "program_upload", documentVersionId: version, uploadContextId: upload)
        let submit = ApplicationDocumentSubmitIntent(studentCaseId: caseId.uuidString.lowercased(), applicationId: appId.uuidString.lowercased(),
            requirementsRevisionId: revision.uuidString.lowercased(), requirementItemId: item.uuidString.lowercased(), documentSlotId: slot.uuidString.lowercased(),
            selection: selection, expectedPreviousSubmissionId: nil)
        let params = try submit.parameters(requestId: request).object("p_student_case_id p_application_id p_requirements_revision_id p_requirement_item_id p_selection p_expected_previous_submission_id p_request_id")
        try check(params["p_expected_previous_submission_id"] == .null, "explicit no previous submission")
        let fixturePath = CommandLine.arguments.dropFirst().first ?? "tests/fixtures/application-requirements-v2.json"
        let corpus = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: fixturePath))) as! [String: Any]
        let vectors = corpus["cases"] as! [[String: Any]]
        let requirements = vectors.compactMap { v -> [String: Any]? in
            guard v["valid"] as? Bool == true, let value = v["value"] as? [String: Any],
                  let items = value["items"] as? [[String: Any]], items.count >= 2 else { return nil }
            return value
        }.first!
        let requirementsItems = requirements["items"] as! [[String: Any]]
        let rows: [[String: Any]] = requirementsItems.map { i in ["requirementItemId": i["requirementItemId"]!, "documentSlotId": i["documentSlotId"]!,
            "savedDraft": NSNull(), "submission": NSNull(), "previousEvidence": NSNull(), "reusableVersions": [], "reusableVersionsNextCursor": NSNull(), "canUpload": true, "canSubmit": true] }
        var reader: [String: Any] = ["protocolVersion": 1, "studentCaseId": requirements["studentCaseId"]!, "applicationId": requirements["applicationId"]!, "requirements": requirements, "items": rows]
        try check(try JSONDecoder().decode(ApplicationDocumentsView.self, from: data(reader)).items.count == rows.count, "nested existing requirements codec shape")
        var reversed = rows; reversed.swapAt(0, 1); reader["items"] = reversed
        try rejects("requirements item order") { _ = try JSONDecoder().decode(ApplicationDocumentsView.self, from: data(reader)) }
        reader["items"] = rows; reader["studentCaseId"] = version
        try rejects("nested case correlation") { _ = try JSONDecoder().decode(ApplicationDocumentsView.self, from: data(reader)) }
        reader["studentCaseId"] = requirements["studentCaseId"]; reader["protocolVersion"] = true
        try rejects("bool is not protocol number") { _ = try JSONDecoder().decode(ApplicationDocumentsView.self, from: data(reader)) }
        reader["protocolVersion"] = 1
        var rowsWithDraft = rows; var matchedDraft = draft
        matchedDraft["requirementItemId"] = rows[0]["requirementItemId"]; matchedDraft["documentSlotId"] = rows[0]["documentSlotId"]
        matchedDraft["requirementsRevisionId"] = requirements["revisionId"]; rowsWithDraft[0]["savedDraft"] = matchedDraft; reader["items"] = rowsWithDraft
        try check(try JSONDecoder().decode(ApplicationDocumentsView.self, from: data(reader)).items[0].savedDraft != nil, "draft exact current revision")
        matchedDraft["requirementsRevisionId"] = version; rowsWithDraft[0]["savedDraft"] = matchedDraft; reader["items"] = rowsWithDraft
        try rejects("draft stale revision") { _ = try JSONDecoder().decode(ApplicationDocumentsView.self, from: data(reader)) }
        let reviewId = "99999999-9999-4999-8999-999999999999"
        let submissionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        let review: [String: Any] = ["reviewId": reviewId, "decision": "correction_required", "reason": "Пожалуйста, замените страницу", "reviewedAt": "2026-09-21T12:01:00Z"]
        let submission: [String: Any] = ["submissionId": submissionId, "requirementsRevisionId": revision.uuidString.lowercased(), "requirementItemId": item.uuidString.lowercased(),
            "documentSlotId": slot.uuidString.lowercased(), "submittedAt": "2026-09-21T12:00:01Z", "file": fileJSON, "review": review]
        var notification: [String: Any] = ["protocolVersion": 1, "notificationId": request, "studentCaseId": caseId.uuidString.lowercased(), "applicationId": appId.uuidString.lowercased(),
            "requirementsRevisionId": revision.uuidString.lowercased(), "requirementItemId": item.uuidString.lowercased(), "documentSlotId": slot.uuidString.lowercased(), "reviewId": reviewId, "submission": submission]
        try check(try JSONDecoder().decode(ApplicationDocumentNotification.self, from: data(notification)).submission.review?.reviewId == reviewId, "notification pins historical review")
        notification["reviewId"] = request
        try rejects("notification different review") { _ = try JSONDecoder().decode(ApplicationDocumentNotification.self, from: data(notification)) }
        var emptyReview = review; emptyReview["reason"] = " "
        try rejects("negative review needs reason") { _ = try ApplicationDocumentReview(json(emptyReview)) }
        try check(try ApplicationDocumentHTTPFailure.decode(data(["error": ["code": "stale_context", "resolution": "not_written"]])).notWritten, "explicit no-write proof")
        for code in ["forbidden", "request_conflict"] {
            try check(try !ApplicationDocumentHTTPFailure.decode(data(["error": ["code": code, "resolution": "not_written"]])).notWritten, "access/conflict retains intent")
        }
        try rejects("malformed no-write proof") { _ = try ApplicationDocumentHTTPFailure.decode(data(["error": ["code": "new_unknown", "resolution": "not_written"]])) }
        let directory = FileManager.default.temporaryDirectory.appending(path: "evo-b3f-codec-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try ApplicationDocumentPendingStore(directory: directory)
        let owner = ApplicationDocumentOwner(actorId: caseId, membershipId: appId, organizationId: revision, studentCaseId: caseId)
        try rejects("intent and scoped case disagree") {
            let wrongOwner = ApplicationDocumentOwner(actorId: caseId, membershipId: appId, organizationId: revision, studentCaseId: slot)
            _ = try store.freeze(owner: wrongOwner, applicationId: intent.applicationId, itemId: intent.requirementItemId, operation: "upload", intent: intent)
        }
        try rejects("wrong operation envelope") {
            _ = try store.freeze(owner: owner, applicationId: intent.applicationId, itemId: intent.requirementItemId, operation: "submit", intent: intent)
        }
        let first = try store.freeze(owner: owner, applicationId: intent.applicationId, itemId: intent.requirementItemId, operation: "upload", intent: intent)
        let reopened = try ApplicationDocumentPendingStore(directory: directory)
        let retry = try reopened.freeze(owner: owner, applicationId: intent.applicationId, itemId: intent.requirementItemId, operation: "upload", intent: intent)
        try check(first == retry, "durable exact replay after store restart")
        let changedFile = try ApplicationDocumentFile(originalFilename: "different.pdf", declaredMimeType: "application/pdf", data: bytes)
        let changed = try ApplicationDocumentUploadIntent(studentCaseId: caseId, applicationId: appId, requirementsRevisionId: revision, requirementItemId: item, documentSlotId: slot, file: changedFile)
        try rejects("unknown intent cannot be overwritten") { _ = try reopened.freeze(owner: owner, applicationId: intent.applicationId, itemId: intent.requirementItemId, operation: "upload", intent: changed) }
        let other = ApplicationDocumentOwner(actorId: slot, membershipId: appId, organizationId: revision, studentCaseId: caseId)
        try check(try reopened.list(owner: other, applicationId: intent.applicationId, operation: "upload", as: ApplicationDocumentUploadIntent.self).isEmpty, "account isolation")
        try check(try reopened.list(owner: owner, applicationId: intent.applicationId, operation: "upload", as: ApplicationDocumentUploadIntent.self).first == first, "old requirement recovery")
        let record = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first!
        let contents = try Data(contentsOf: record)
        try check(contents.range(of: bytes) == nil && !String(decoding: contents, as: UTF8.self).contains("offline-test-token"), "no bytes or token persisted")
        try Data("corrupt".utf8).write(to: record)
        try rejects("corrupt intent blocks new UUID") { _ = try reopened.freeze(owner: owner, applicationId: intent.applicationId, itemId: intent.requirementItemId, operation: "upload", intent: intent) }
        print("PASS \(count) offline programme-document protocol/replay checks; no runtime acceptance claimed")
    }
}
