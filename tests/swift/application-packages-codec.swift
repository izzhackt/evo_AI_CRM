import Foundation

// Constructed protocol vectors and temporary metadata records only. These
// checks exercise no Auth, database, Storage, UI or application runtime.
@main struct ApplicationPackagesCodecChecks {
    enum Failure: Error { case check(String) }
    static var count = 0
    static func check(_ condition: @autoclosure () throws -> Bool, _ name: String) throws {
        count += 1; guard try condition() else { throw Failure.check(name) }
    }
    static func rejects(_ name: String, _ action: () throws -> Void) throws {
        count += 1; do { try action() } catch { return }; throw Failure.check(name)
    }
    static func id(_ n: Int) -> String { String(format: "00000000-0000-4000-8000-%012d", n) }
    static func data(_ value: Any) throws -> Data { try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) }
    static func raw(_ value: Any) throws -> ApplicationDocumentJSON { try JSONDecoder().decode(ApplicationDocumentJSON.self, from: data(value)) }
    static func main() throws {
        do { try run(); print("PASS \(count) offline package codec/recovery checks; no runtime acceptance claimed") }
        catch { FileHandle.standardError.write(Data("FAIL after \(count) checks: \(error)\n".utf8)); exit(1) }
    }

    static func run() throws {
        let stamp = "2026-09-21T12:00:00.123456+00:00"
        let target: [String: Any] = ["studentCaseId": id(1), "applicationId": id(2)]
        let selection: [String: Any] = ["kind": "existing_version", "documentVersionId": id(8)]
        let selected: [String: Any] = ["requirementItemId": id(4), "selection": selection, "expectedPreviousSubmissionId": NSNull()]
        var submit = target
        submit.merge(["requirementsRevisionId": id(3), "expectedPreviousPackageId": NSNull(), "items": [selected], "requestId": id(6)]) { _, new in new }
        let submitIntent = try ApplicationPackageSubmitIntent(raw(submit))
        try check(try JSONDecoder().decode(ApplicationPackageSubmitIntent.self, from: JSONEncoder().encode(submitIntent)) == submitIntent, "exact submit roundtrip")
        try check(try submitIntent.raw == raw(submit), "submit encoding preserves explicit nulls")
        var omitted = submit; omitted.removeValue(forKey: "expectedPreviousPackageId")
        try rejects("missing explicit nullable field") { _ = try ApplicationPackageSubmitIntent(raw(omitted)) }
        var extra = submit; extra["actorId"] = id(90)
        try rejects("client authority field") { _ = try ApplicationPackageSubmitIntent(raw(extra)) }
        var badSelection = selected; badSelection["selection"] = ["kind": "existing_version", "documentVersionId": id(8), "uploadContextId": NSNull()]
        try rejects("selection closed union") { _ = try ApplicationPackageSelectionItem(raw(badSelection)) }
        for items in [[], [selected, selected], (0...100).map { n in ["requirementItemId": id(100+n), "selection": selection, "expectedPreviousSubmissionId": NSNull()] as [String: Any] }] {
            var bad = submit; bad["items"] = items; try rejects("invalid composition count or duplicates") { _ = try ApplicationPackageSubmitIntent(raw(bad)) }
        }
        var hundred = submit
        hundred["items"] = (0..<100).map { n in ["requirementItemId": id(100+n), "selection": selection, "expectedPreviousSubmissionId": NSNull()] as [String: Any] }
        try check(try ApplicationPackageSubmitIntent(raw(hundred)).items.count == 100, "100 package selections")

        let file: [String: Any] = ["documentVersionId": id(8), "versionNo": "9007199254740993", "originalFilename": "паспорт.pdf", "declaredMimeType": "application/pdf",
            "byteSize": "20", "sha256Hex": String(repeating: "a", count: 64), "finalizedAt": stamp, "technicalAvailability": "available", "unavailableReasons": []]
        let definition: [String: Any] = ["requirementKey": "evo.passport.v1", "required": true, "label": "Паспорт", "groupLabel": "Личные документы", "instructions": "Сохранить все страницы", "deadline": ["date": "2026-12-01", "time": "17:00", "timezone": "Asia/Bishkek", "sourceUrl": "https://example.org/deadline", "verifiedOn": "2026-09-21"], "documentSlotId": id(5)]
        let approved: [String: Any] = ["reviewId": id(20), "decision": "approved", "reason": NSNull(), "reviewedAt": stamp]
        let expectation: [String: Any] = ["requirementItemId": id(4), "submissionId": id(9), "expectedReviewId": id(20)]
        let evidence: [String: Any] = ["requirementItemId": id(4), "submissionId": id(9), "review": approved, "reusedFromSubmissionId": NSNull(), "reusedFromReview": NSNull()]
        let packageReview: [String: Any] = ["packageReviewId": id(21), "packageId": id(10), "decision": "approved", "reason": NSNull(), "affectedItemIds": [], "documentReviews": [evidence], "reviewedAt": stamp]
        var review = target
        review.merge(["packageId": id(10), "expectedPreviousReviewId": NSNull(), "decision": "approved", "reason": NSNull(), "affectedItemIds": [], "documentReviews": [expectation], "reuseApprovals": [], "requestId": id(22)]) { _, new in new }
        let reviewIntent = try ApplicationPackageReviewIntent(raw(review))
        try check(try reviewIntent.raw == raw(review), "review encoding preserves exact vector and nulls")
        var negative = review; negative["decision"] = "correction_required"; negative["reason"] = "Исправьте\nстраницу"; negative["affectedItemIds"] = [id(4)]
        try check(try ApplicationPackageReviewIntent(raw(negative)).decision == .correctionRequired, "correction permits paragraph reason")
        for reason in ["", " ", String(repeating: "я", count: 5001)] {
            var bad = negative; bad["reason"] = reason; try rejects("invalid correction reason") { _ = try ApplicationPackageReviewIntent(raw(bad)) }
        }
        var nulReason = negative; nulReason["reason"] = "Исправьте\u{0000}страницу"
        try rejects("JSONB-incompatible U+0000 reason") { _ = try ApplicationPackageReviewIntent(raw(nulReason)) }
        for reason in ["Paragraph\n\r\t\u{0001}\u{000B}\u{0085}text", String(repeating: "🙂", count: 5000)] {
            var supported = negative; supported["reason"] = reason
            try check(try ApplicationPackageReviewIntent(raw(supported)).reason == reason, "supported controls and 5000 scalar reason preserved")
        }
        var badAffected = negative; badAffected["affectedItemIds"] = [id(99)]
        try rejects("affected item outside vector") { _ = try ApplicationPackageReviewIntent(raw(badAffected)) }
        var duplicateExpectations = review; duplicateExpectations["documentReviews"] = [expectation, expectation]
        try rejects("duplicate review vector") { _ = try ApplicationPackageReviewIntent(raw(duplicateExpectations)) }
        let sourceReview: [String: Any] = ["reviewId": id(23), "decision": "approved", "reason": NSNull(), "reviewedAt": stamp]
        var reuse = expectation; reuse["sourceSubmissionId"] = id(24); reuse["sourceReviewId"] = id(23)
        var withReuse = review; withReuse["reuseApprovals"] = [reuse]
        let reuseIntent = try ApplicationPackageReviewIntent(raw(withReuse))
        var selfReuse = reuse; selfReuse["sourceSubmissionId"] = expectation["submissionId"]
        var selfReuseIntent = withReuse; selfReuseIntent["reuseApprovals"] = [selfReuse]
        try rejects("source cannot be current submission") { _ = try ApplicationPackageReuseApproval(raw(selfReuse)) }
        try rejects("self-reuse review intent matches TS and SQL rejection") { _ = try ApplicationPackageReviewIntent(raw(selfReuseIntent)) }
        var reusedEvidence = evidence; reusedEvidence["reusedFromSubmissionId"] = id(24); reusedEvidence["reusedFromReview"] = sourceReview
        var reusedReview = packageReview; reusedReview["documentReviews"] = [reusedEvidence]
        var negativeReuse = negative; negativeReuse["reuseApprovals"] = [reuse]
        try rejects("correction cannot reuse approvals") { _ = try ApplicationPackageReviewIntent(raw(negativeReuse)) }
        var partialReuseEvidence = reusedEvidence; partialReuseEvidence["reusedFromReview"] = NSNull()
        try rejects("source reuse must include both references") { _ = try ApplicationPackageReviewEvidence(raw(partialReuseEvidence)) }
        var unreviewedEvidence = evidence; unreviewedEvidence["review"] = NSNull()
        var unreviewedPackage = packageReview; unreviewedPackage["documentReviews"] = [unreviewedEvidence]
        try rejects("package approval requires every included file approval") { _ = try ApplicationPackageReview(raw(unreviewedPackage)) }

        let summary: [String: Any] = ["packageId": id(10), "requirementsRevisionId": id(3), "requirementsRevisionVersion": "9007199254740993", "origin": "staff_confirmed", "configurationState": "confirmed",
            "packageVersion": "9223372036854775807", "previousPackageId": NSNull(), "compositionSha256": String(repeating: "b", count: 64), "submittedAt": stamp, "itemCount": 1, "isCurrentRequirements": false, "latestReview": packageReview]
        try check(try ApplicationPackageSummary(raw(summary)).packageVersion == "9223372036854775807", "bigint decimal preserved")
        for value: Any in [1, "0", "01", "9223372036854775808"] {
            var bad = summary; bad["packageVersion"] = value; try rejects("invalid package decimal") { _ = try ApplicationPackageSummary(raw(bad)) }
        }
        var badCount = summary; badCount["itemCount"] = true
        try rejects("boolean is not count") { _ = try ApplicationPackageSummary(raw(badCount)) }
        var wrongPair = summary; wrongPair["origin"] = "evo_starter"
        try rejects("origin and configuration must match") { _ = try ApplicationPackageSummary(raw(wrongPair)) }
        let program: [String: Any] = ["institutionId": id(11), "publicationId": id(12), "programId": "computer-science-2026", "intakeId": id(13), "universityTitle": "University", "programTitle": "Computer Science", "intakeLabel": "Autumn"]
        try check(try ApplicationPackageProgram(raw(program)).programId == "computer-science-2026", "214 program slug")
        let submission: [String: Any] = ["submissionId": id(9), "requirementsRevisionId": id(3), "requirementItemId": id(4), "documentSlotId": id(5), "submittedAt": stamp, "file": file, "review": approved]
        let item: [String: Any] = ["packageItemId": id(14), "requirementItemId": id(4), "definition": definition, "materialSnapshot": NSNull(), "selection": selection, "submission": submission]
        var detail = target; detail.merge(["protocolVersion": 1, "package": summary, "program": program, "items": [item], "currentWarnings": []]) { _, new in new }
        let parsed = try ApplicationPackageDetail(raw(detail))
        try check(parsed.items[0].definition.deadline?.timezone == "Asia/Bishkek" && parsed.items[0].definition.required, "exact historical definition retained")
        try parsed.validate(studentCaseId: id(1), applicationId: id(2), packageId: id(10))
        try rejects("detail wrong case") { try parsed.validate(studentCaseId: id(99), applicationId: id(2), packageId: id(10)) }
        try rejects("detail wrong package") { try parsed.validate(studentCaseId: id(1), applicationId: id(2), packageId: id(99)) }
        var changedReview = approved; changedReview["reviewId"] = id(25); changedReview["decision"] = "correction_required"; changedReview["reason"] = "Новая проблема"
        var changedSubmission = submission; changedSubmission["review"] = changedReview
        var changedItem = item; changedItem["submission"] = changedSubmission
        var changedDetail = detail; changedDetail["items"] = [changedItem]; changedDetail["currentWarnings"] = [["requirementItemId": id(4), "submissionId": id(9), "reason": "review_changed", "currentReview": changedReview]]
        let changed = try ApplicationPackageDetail(raw(changedDetail))
        try check(changed.package.latestReview?.documentReviews[0].review?.reviewId == id(20) && changed.items[0].submission.review?.reviewId == id(25), "later individual correction does not rewrite package decision")
        var hiddenChangedReview = changedDetail; hiddenChangedReview["currentWarnings"] = []
        try rejects("changed review warning cannot be omitted") { _ = try ApplicationPackageDetail(raw(hiddenChangedReview)) }
        var unavailableFile = file; unavailableFile["technicalAvailability"] = "unavailable"; unavailableFile["unavailableReasons"] = ["storage_object_unavailable"]
        var unavailableSubmission = submission; unavailableSubmission["file"] = unavailableFile
        var unavailableItem = item; unavailableItem["submission"] = unavailableSubmission
        var unavailableDetail = detail; unavailableDetail["items"] = [unavailableItem]
        try rejects("file availability warning cannot be omitted") { _ = try ApplicationPackageDetail(raw(unavailableDetail)) }
        unavailableDetail["currentWarnings"] = [["requirementItemId": id(4), "submissionId": id(9), "reason": "file_unavailable", "currentReview": approved]]
        try check(try ApplicationPackageDetail(raw(unavailableDetail)).currentWarnings.count == 1, "unavailable file preserves decision and exposes warning")
        var wrongWarning = changedDetail; wrongWarning["currentWarnings"] = [["requirementItemId": id(4), "submissionId": id(9), "reason": "review_changed", "currentReview": approved]]
        try rejects("warning must match current submission review") { _ = try ApplicationPackageDetail(raw(wrongWarning)) }
        var wrongItem = item; var wrongSubmission = submission; wrongSubmission["documentSlotId"] = id(99); wrongItem["submission"] = wrongSubmission
        try rejects("package item slot mismatch") { _ = try ApplicationPackageItem(raw(wrongItem)) }

        var history = target; history.merge(["protocolVersion": 1, "packages": [summary], "nextCursor": ["createdAt": stamp, "id": id(10)]]) { _, new in new }
        try check(try ApplicationPackageHistory(raw(history)).packages.count == 1, "history cursor matches")
        var wrongCursor = history; wrongCursor["nextCursor"] = ["createdAt": "2026-09-21T12:00:00.123455Z", "id": id(10)]
        try rejects("microsecond cursor mismatch") { _ = try ApplicationPackageHistory(raw(wrongCursor)) }
        var reviewHistory = target; reviewHistory.merge(["protocolVersion": 1, "packageId": id(10), "reviews": [packageReview], "nextCursor": NSNull()]) { _, new in new }
        try check(try ApplicationPackageReviewHistory(raw(reviewHistory)).reviews.count == 1, "review history")
        try rejects("review history wrong package target") { try ApplicationPackageReviewHistory(raw(reviewHistory)).validate(studentCaseId: id(1), applicationId: id(2), packageId: id(99)) }
        var queueItem = target; queueItem.merge(["studentDisplayName": "Student", "program": program, "package": summary]) { _, new in new }
        try check(try ApplicationPackageQueue(raw(["protocolVersion": 1, "items": [queueItem], "nextCursor": NSNull()])).items.count == 1, "queue exact shape")
        var notification = target; notification.merge(["protocolVersion": 1, "notificationId": id(30), "packageId": id(10), "packageReviewId": id(21), "review": packageReview]) { _, new in new }
        try check(try ApplicationPackageNotification(raw(notification)).review.packageReviewId == id(21), "notification pins review")
        try rejects("notification wrong owner case") { try ApplicationPackageNotification(raw(notification)).validate(notificationId: id(30), studentCaseId: id(99)) }
        notification["packageReviewId"] = id(99)
        try rejects("notification wrong review") { _ = try ApplicationPackageNotification(raw(notification)) }

        var receipt = target; receipt.merge(["protocolVersion": 1, "requestId": id(6), "packageId": id(10), "requirementsRevisionId": id(3), "packageVersion": "1", "compositionSha256": String(repeating: "b", count: 64), "submittedAt": stamp, "reused": false,
            "items": [["packageItemId": id(14), "requirementItemId": id(4), "documentSlotId": id(5), "documentVersionId": id(8), "submissionId": id(9)]]]) { _, new in new }
        let submitReceipt = try ApplicationPackageSubmitReceipt(raw(receipt)); try submitReceipt.validate(submitIntent); try check(true, "matching submit receipt")
        var wrongReceipt = receipt; wrongReceipt["requestId"] = id(99)
        try rejects("wrong receipt request") { try ApplicationPackageSubmitReceipt(raw(wrongReceipt)).validate(submitIntent) }
        var reviewReceipt = target; reviewReceipt.merge(["protocolVersion": 1, "requestId": id(22), "packageId": id(10), "packageReview": packageReview]) { _, new in new }
        try ApplicationPackageReviewReceipt(raw(reviewReceipt)).validate(reviewIntent); try check(true, "matching review receipt")
        var sourceReceipt = reviewReceipt; sourceReceipt["packageReview"] = reusedReview
        try ApplicationPackageReviewReceipt(raw(sourceReceipt)).validate(reuseIntent); try check(true, "approved current review retains expected ID with explicit reuse")
        try rejects("unexpected source reuse") { try ApplicationPackageReviewReceipt(raw(sourceReceipt)).validate(reviewIntent) }
        var freshExpectation = expectation; freshExpectation["expectedReviewId"] = NSNull()
        var freshReuse = reuse; freshReuse["expectedReviewId"] = NSNull()
        var freshReviewIntent = withReuse; freshReviewIntent["documentReviews"] = [freshExpectation]; freshReviewIntent["reuseApprovals"] = [freshReuse]
        try ApplicationPackageReviewReceipt(raw(sourceReceipt)).validate(ApplicationPackageReviewIntent(raw(freshReviewIntent))); try check(true, "new current approval only from explicit reuse")
        var arbitraryNewReview = try reviewIntent.raw
        if case .object(var values) = arbitraryNewReview { values["documentReviews"] = .array([try raw(freshExpectation)]); arbitraryNewReview = .object(values) }
        try rejects("new review without explicit reuse") { try ApplicationPackageReviewReceipt(raw(reviewReceipt)).validate(ApplicationPackageReviewIntent(arbitraryNewReview)) }

        let committed: [String: Any] = ["protocolVersion": 1, "operation": "submit", "requestId": id(6), "studentCaseId": id(1), "applicationId": id(2), "status": "committed", "receipt": receipt]
        let absent: [String: Any] = ["protocolVersion": 1, "operation": "submit", "requestId": id(6), "studentCaseId": id(1), "applicationId": id(2), "status": "not_written", "receipt": NSNull()]
        if case .submit = try ApplicationPackageRecovery.decode(data(committed), intent: submitIntent) { try check(true, "committed recovery") } else { throw Failure.check("recovery kind") }
        try rejects("wrong recovery operation") { _ = try ApplicationPackageRecovery.decode(data(absent), intent: reviewIntent) }
        for key in ["requestId", "studentCaseId", "applicationId"] {
            var bad = absent; bad[key] = id(99)
            try rejects("not_written binds \(key)") { _ = try ApplicationPackageRecovery.decode(data(bad), intent: submitIntent) }
        }
        var invalidRecovery = absent; invalidRecovery["receipt"] = receipt
        try rejects("not_written must have null receipt") { _ = try ApplicationPackageRecovery.decode(data(invalidRecovery), intent: submitIntent) }
        try rejects("mutation error is not recovery proof") { _ = try ApplicationPackageRecovery.decode(data(["code": "PT409", "message": "application_package_not_ready"]), intent: submitIntent) }

        let directory = FileManager.default.temporaryDirectory.appending(path: "evo-package-codec-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try ApplicationPackagePendingStore(directory: directory)
        let owner = ApplicationPackageOwner(actorId: UUID(uuidString: id(40))!, membershipId: UUID(uuidString: id(41))!, organizationId: UUID(uuidString: id(42))!)
        try rejects("U+0000 cannot enter pending freeze") { _ = try store.freeze(owner: owner, intent: ApplicationPackageReviewIntent(raw(nulReason))) }
        try check(try store.list(owner: owner, as: ApplicationPackageReviewIntent.self).isEmpty, "invalid reason persists no pending record")
        try rejects("self-reuse cannot enter pending freeze") { _ = try store.freeze(owner: owner, intent: ApplicationPackageReviewIntent(raw(selfReuseIntent))) }
        try check(try store.list(owner: owner, as: ApplicationPackageReviewIntent.self).isEmpty, "self-reuse persists no pending record")
        let first = try store.freeze(owner: owner, intent: submitIntent)
        let reopened = try ApplicationPackagePendingStore(directory: directory)
        try check(try reopened.freeze(owner: owner, intent: submitIntent) == first, "durable exact request after restart")
        var changedIntent = submit; changedIntent["requestId"] = id(99)
        try rejects("new UUID cannot replace unresolved operation") { _ = try reopened.freeze(owner: owner, intent: ApplicationPackageSubmitIntent(raw(changedIntent))) }
        let pendingReview = try store.freeze(owner: owner, intent: reviewIntent)
        var inventory = ApplicationPackageRecoveryInventory(); try inventory.refresh(owner: owner, store: reopened)
        try check(inventory.submissions == [first] && inventory.reviews == [pendingReview], "detached recovery retains requests without queue or revision")
        var otherTarget = submit; otherTarget["studentCaseId"] = id(50); otherTarget["applicationId"] = id(51); otherTarget["requestId"] = id(52)
        _ = try store.freeze(owner: owner, intent: ApplicationPackageSubmitIntent(raw(otherTarget)))
        try inventory.refresh(owner: owner, store: reopened); try check(inventory.submissions.count == 2, "inventory spans own cases and programs")
        let foreign = ApplicationPackageOwner(actorId: UUID(uuidString: id(90))!, membershipId: UUID(uuidString: id(41))!, organizationId: UUID(uuidString: id(42))!)
        try inventory.refresh(owner: foreign, store: reopened); try check(inventory.submissions.isEmpty && inventory.reviews.isEmpty, "account switch clears previous rows")
        try rejects("wrong receipt does not clear") { try reopened.resolve(first, receipt: ApplicationPackageSubmitReceipt(raw(wrongReceipt))) }
        try check(try reopened.load(owner: owner, intent: submitIntent) == first, "pending retained after receipt mismatch")
        try rejects("malformed recovery does not clear") { _ = try reopened.resolve(first, recoveryData: data(invalidRecovery)) }
        try check(try reopened.load(owner: owner, intent: submitIntent) == first, "pending retained after malformed recovery")
        try reopened.resolve(first, recoveryData: data(absent)); try check(try reopened.load(owner: owner, intent: submitIntent) == nil, "authoritative not_written clears")
        _ = try reopened.freeze(owner: owner, intent: submitIntent); try reopened.resolve(first, receipt: submitReceipt)
        try check(try reopened.load(owner: owner, intent: submitIntent) == nil, "matching receipt clears before any cache refresh")
        try reopened.resolve(pendingReview, receipt: ApplicationPackageReviewReceipt(raw(reviewReceipt)))
        try check(try reopened.list(owner: owner, as: ApplicationPackageReviewIntent.self).isEmpty, "review resolution clears detached record")
        _ = try reopened.freeze(owner: foreign, intent: submitIntent)
        let folders = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        for folder in folders {
            for url in try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) {
                let bytes = try Data(contentsOf: url)
                if String(decoding: bytes, as: UTF8.self).contains(id(90)) { try Data("corrupt foreign record".utf8).write(to: url) }
            }
        }
        try check(try reopened.list(owner: owner, as: ApplicationPackageSubmitIntent.self).count == 1, "foreign corruption cannot block current owner")
        try rejects("own corrupted record blocks recovery") { _ = try reopened.list(owner: foreign, as: ApplicationPackageSubmitIntent.self) }
        try rejects("own corruption cannot mint new UUID") { _ = try reopened.freeze(owner: foreign, intent: ApplicationPackageSubmitIntent(raw(changedIntent))) }
        try readinessChecks()
        try sharedFixtureChecks(path: CommandLine.arguments.dropFirst().first ?? "tests/fixtures/application-packages-v1.json")
    }

    static func readinessChecks() throws {
        let corpus = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "tests/fixtures/application-requirements-v2.json"))) as! [String: Any]
        let cases = corpus["cases"] as! [[String: Any]]
        var requirements = cases.compactMap { v -> [String: Any]? in
            guard v["valid"] as? Bool == true, let value = v["value"] as? [String: Any], value["origin"] as? String == "staff_confirmed", value["state"] as? String == "initialized" else { return nil }; return value
        }.first!
        let original = (requirements["items"] as! [[String: Any]])[0]
        let requirementRows = (0..<100).map { n -> [String: Any] in
            var row = original; row["requirementItemId"] = id(1000+n); row["documentSlotId"] = id(2000+n); row["requirementKey"] = "custom.item.\(n)"; row["position"] = n+1; return row
        }
        requirements["items"] = requirementRows
        let documents = requirementRows.map { row -> [String: Any] in
            ["requirementItemId": row["requirementItemId"]!, "documentSlotId": row["documentSlotId"]!, "savedDraft": NSNull(), "submission": NSNull(), "previousEvidence": NSNull(), "reusableVersions": [], "reusableVersionsNextCursor": NSNull(), "canUpload": true, "canSubmit": true]
        }
        let readiness: [String: Any] = ["protocolVersion": 1, "studentCaseId": requirements["studentCaseId"]!, "applicationId": requirements["applicationId"]!, "requirements": requirements, "documentItems": documents,
            "latestPackage": NSNull(), "selections": [], "missingRequiredItemIds": requirementRows.filter { $0["required"] as? Bool == true }.map { $0["requirementItemId"]! }, "reasons": ["empty_composition", "missing_required"], "canSubmit": false]
        try check(try ApplicationPackageReadiness(raw(readiness)).documentItems.count == 100, "readiness uses 100 bound independently of Documents")
        var invalid = readiness; invalid["canSubmit"] = true
        try rejects("incomplete composition cannot claim ready") { _ = try ApplicationPackageReadiness(raw(invalid)) }
    }

    static func sharedFixtureChecks(path: String) throws {
        let corpus = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        func value(_ key: String) throws -> ApplicationDocumentJSON { guard let v = corpus[key] else { throw Failure.check("shared key \(key)") }; return try raw(v) }
        let submit = try ApplicationPackageSubmitIntent(value("submitIntent")), review = try ApplicationPackageReviewIntent(value("reviewIntent"))
        try check(try submit.raw == value("submitIntent"), "shared submit exact wire")
        try check(try review.raw == value("reviewIntent"), "shared review exact wire")
        try ApplicationPackageSubmitReceipt(value("submitReceipt")).validate(submit); try check(true, "shared submit receipt binding")
        try ApplicationPackageReviewReceipt(value("reviewReceipt")).validate(review); try check(true, "shared review receipt binding")
        try ApplicationPackageReviewReceipt(value("reuseReviewReceipt")).validate(ApplicationPackageReviewIntent(value("reuseReviewIntent"))); try check(true, "shared explicit reuse evidence")
        let ready = try ApplicationPackageReadiness(value("readiness"))
        try check(ready.canSubmit && ready.requirements.revision?.origin == .evoStarter, "shared starter readiness without previous file approval")
        try check(ready.documentItems.allSatisfy { $0.submission == nil }, "shared canonical selected files independent of submissions")
        _ = try ApplicationPackageDetail(value("detail")); try check(true, "shared detail")
        _ = try ApplicationPackageHistory(value("history")); try check(true, "shared history")
        _ = try ApplicationPackageReviewHistory(value("reviewHistory")); try check(true, "shared review history")
        _ = try ApplicationPackageQueue(value("queue")); try check(true, "shared queue")
        _ = try ApplicationPackageNotification(value("notification")); try check(true, "shared exact notification")
        _ = try ApplicationPackageRecovery.decode(data(corpus["recoveryCommitted"]!), intent: submit); try check(true, "shared committed recovery")
        _ = try ApplicationPackageRecovery.decode(data(corpus["recoveryAbsent"]!), intent: submit); try check(true, "shared absent recovery")
        var reversed = corpus["submitReceipt"] as! [String: Any]; reversed["items"] = Array((reversed["items"] as! [Any]).reversed())
        try rejects("shared receipt cannot reorder frozen composition") { try ApplicationPackageSubmitReceipt(raw(reversed)).validate(submit) }
        var stale = corpus["recoveryAbsent"] as! [String: Any]; stale["requestId"] = id(99)
        try rejects("shared recovery binds request before clearing") { _ = try ApplicationPackageRecovery.decode(data(stale), intent: submit) }
        var missing = corpus["readiness"] as! [String: Any]; missing["selections"] = []; missing["canSubmit"] = false
        try rejects("shared reader cannot hide missing required items") { _ = try ApplicationPackageReadiness(raw(missing)) }
    }
}
