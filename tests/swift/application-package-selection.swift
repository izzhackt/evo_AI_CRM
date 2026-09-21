import Foundation

// Constructed protocol vectors only; this is not native UI or live acceptance.
@main struct ApplicationPackageSelectionChecks {
    enum Failure: Error { case check(String) }
    static var count = 0
    static func check(_ value: @autoclosure () throws -> Bool, _ name: String) throws {
        count += 1; guard try value() else { throw Failure.check(name) }
    }
    static func decode(_ raw: [String: Any]) throws -> ApplicationPackageReadiness {
        try JSONDecoder().decode(ApplicationPackageReadiness.self, from: JSONSerialization.data(withJSONObject: raw))
    }
    static func main() {
        do { try run() }
        catch { FileHandle.standardError.write(Data("FAIL after \(count) checks: \(error)\n".utf8)); exit(1) }
    }
    static func run() throws {
        let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "tests/fixtures/application-packages-v1.json"))) as! [String: Any]
        let original = fixture["readiness"] as! [String: Any]
        let ready = try decode(original)
        var state = ProgramPackageSelectionState()
        state.observe(ready)
        try check(state.items(for: ready).isEmpty, "reader selections never silently become the Student's choices")
        for item in ready.documentItems.reversed() {
            let version = item.reusableVersions[0]
            try state.choose(item: item, selection: version.selection, file: version.file)
        }
        let selected = state.items(for: ready)
        try check(selected.map(\.requirementItemId) == ready.documentItems.map(\.id), "explicit choices preserve requirement order")
        try check(ready.canSubmit && ready.documentItems.allSatisfy { $0.submission == nil }, "Student composition does not require prior staff approvals")

        var saved = original
        var documents = saved["documentItems"] as! [[String: Any]]
        var replacementFile = (documents[0]["reusableVersions"] as! [[String: Any]])[0]["file"] as! [String: Any]
        replacementFile["documentVersionId"] = "b3a10000-0000-4000-8000-000000000901"
        replacementFile["versionNo"] = "9007199254740993"
        replacementFile["originalFilename"] = "replacement.pdf"
        let requirements = original["requirements"] as! [String: Any]
        documents[0]["savedDraft"] = ["uploadContextId": "b3a10000-0000-4000-8000-000000000902",
            "requirementsRevisionId": requirements["revisionId"]!, "requirementItemId": documents[0]["requirementItemId"]!,
            "documentSlotId": documents[0]["documentSlotId"]!, "admittedAt": "2026-09-21T12:00:00.000000+00:00", "file": replacementFile]
        saved["documentItems"] = documents
        let newDraft = try decode(saved)
        state.observe(newDraft)
        try check(state.items(for: newDraft) == selected, "saving a new draft cannot replace the chosen version or frozen previous-submission expectation")
        try check(state.choices[ready.documentItems[0].id]?.file.id != newDraft.documentItems[0].savedDraft?.file.id, "preview keeps original chosen file metadata")
        let draft = newDraft.documentItems[0].savedDraft!
        try state.choose(item: newDraft.documentItems[0], selection: .init(kind: "program_upload", documentVersionId: draft.file.id, uploadContextId: draft.uploadContextId), file: draft.file)
        try check(state.items(for: newDraft)[0].selection.documentVersionId == draft.file.id, "explicit replacement chooses the exact saved draft")

        var optionalRaw = original
        var optionalRequirements = requirements
        optionalRequirements["origin"] = "staff_confirmed"
        optionalRequirements["configurationState"] = "confirmed"
        var requiredItems = optionalRequirements["items"] as! [[String: Any]]
        requiredItems[1]["required"] = false; optionalRequirements["items"] = requiredItems; optionalRaw["requirements"] = optionalRequirements
        let optional = try decode(optionalRaw), optionalId = optional.documentItems[1].id
        state.reset(optional)
        try check(!state.missingOptionalFile(in: optional), "excluded optional needs no file")
        state.include(optionalId, value: true)
        try check(state.missingOptionalFile(in: optional), "included optional without a file blocks confirmation")
        let optionalVersion = optional.documentItems[1].reusableVersions[0]
        try state.choose(item: optional.documentItems[1], selection: optionalVersion.selection, file: optionalVersion.file)
        try check(!state.missingOptionalFile(in: optional) && state.items(for: optional).count == 1, "included optional contributes its exact choice")
        state.include(optionalId, value: false)
        try check(state.items(for: optional).isEmpty && state.choices[optionalId] == nil, "excluding optional removes it from composition")

        var submittedRaw = original
        var submittedDocuments = original["documentItems"] as! [[String: Any]]
        let detail = fixture["detail"] as! [String: Any], packageItems = detail["items"] as! [[String: Any]]
        submittedDocuments[0]["submission"] = packageItems[0]["submission"]
        submittedRaw["documentItems"] = submittedDocuments
        let submitted = try decode(submittedRaw), submission = submitted.documentItems[0].submission!
        state.reset(submitted)
        try state.choose(item: submitted.documentItems[0], selection: .init(kind: "existing_version", documentVersionId: submission.file.id), file: submission.file)
        try check(state.items(for: submitted)[0].selection.documentVersionId == submission.file.id && state.items(for: submitted)[0].expectedPreviousSubmissionId == submission.submissionId, "selecting a previously sent file pins its exact version and observed previous-submission expectation")

        var revisedRaw = original, revisedRequirements = requirements
        revisedRequirements["revisionId"] = "b3e10000-0000-4000-8000-000000000903"
        revisedRequirements["revisionVersion"] = "2"; revisedRaw["requirements"] = revisedRequirements
        let revised = try decode(revisedRaw)
        state.observe(revised)
        try check(state.revisionChanged && state.choices[submission.requirementItemId]?.file.id == submission.file.id, "revision changes retain visible old choice without remapping")
        do {
            try state.choose(item: revised.documentItems[0], selection: revised.documentItems[0].reusableVersions[0].selection, file: revised.documentItems[0].reusableVersions[0].file)
            throw Failure.check("changed revision accepted a new choice before explicit reset")
        } catch ApplicationPackageClientError.invalidIntent { count += 1 }
        state.reset(revised)
        try check(!state.revisionChanged && state.items(for: revised).isEmpty, "explicit revision reset requires fresh choices")
        do {
            try state.choose(item: revised.documentItems[0], selection: revised.documentItems[0].reusableVersions[0].selection, file: revised.documentItems[1].reusableVersions[0].file)
            throw Failure.check("mismatched displayed file accepted")
        } catch ApplicationPackageClientError.invalidIntent { count += 1 }

        try check(AdmissionNotificationPolicy.target(category: "document", eventCode: "application_package_review") == .programPackageReview, "package event takes exact package-review target before category fallback")
        try check(AdmissionNotificationPolicy.target(category: "document", eventCode: "application_document_review") == .programDocumentReview, "individual review navigation preserved")

        func review(_ value: [String: Any]) throws -> ApplicationPackageReview {
            try JSONDecoder().decode(ApplicationPackageReview.self, from: JSONSerialization.data(withJSONObject: value))
        }
        let notification = fixture["notification"] as! [String: Any]
        let approvedRaw = notification["review"] as! [String: Any], approved = try review(approvedRaw)
        var oldCorrectionRaw = approvedRaw
        oldCorrectionRaw["packageReviewId"] = "b3a10000-0000-4000-8000-000000000904"
        oldCorrectionRaw["decision"] = "correction_required"
        oldCorrectionRaw["reason"] = "Уточните состав пакета."
        oldCorrectionRaw["affectedItemIds"] = [approved.documentReviews[0].requirementItemId]
        oldCorrectionRaw["reviewedAt"] = "2026-09-21T09:00:00.000000+00:00"
        let oldCorrection = try review(oldCorrectionRaw)
        let corrected = ProgramPackageReviewPresentation(historical: oldCorrection, latest: approved)
        try check(corrected.displayed?.packageReviewId == oldCorrection.packageReviewId && corrected.displayed?.reason == oldCorrection.reason,
            "historical correction and reason remain the displayed decision")
        try check(corrected.later?.decision == .approved && corrected.later?.reviewedAt == approved.reviewedAt
            && corrected.displayed?.documentReviews.map({ $0.review?.reviewId }) == corrected.later?.documentReviews.map({ $0.review?.reviewId }),
            "later package approval is visible even when all file review IDs are unchanged")

        var laterCorrectionRaw = oldCorrectionRaw
        laterCorrectionRaw["reviewedAt"] = "2026-09-21T11:00:00.000000+00:00"
        let laterCorrection = try review(laterCorrectionRaw)
        let returned = ProgramPackageReviewPresentation(historical: approved, latest: laterCorrection)
        try check(returned.displayed?.decision == .approved && returned.later?.decision == .correctionRequired
            && returned.later?.reason == laterCorrection.reason && returned.later?.affectedItemIds == laterCorrection.affectedItemIds,
            "later correction keeps reason and affected material references separately from old approval")

        var changedFileRaw = laterCorrectionRaw
        var changedEvidence = changedFileRaw["documentReviews"] as! [[String: Any]]
        var changedFileReview = changedEvidence[0]["review"] as! [String: Any]
        changedFileReview["reviewId"] = "b3a10000-0000-4000-8000-000000000905"
        changedFileReview["reviewedAt"] = "2026-09-21T10:45:00.000000+00:00"
        changedEvidence[0]["review"] = changedFileReview; changedFileRaw["documentReviews"] = changedEvidence
        let fileChanged = ProgramPackageReviewPresentation(historical: approved, latest: try review(changedFileRaw))
        try check(fileChanged.displayed?.documentReviews[0].review?.reviewId == approved.documentReviews[0].review?.reviewId
            && fileChanged.later?.documentReviews[0].review?.reviewId == changedFileReview["reviewId"] as? String,
            "changed file reviews never replace frozen historical evidence while later package decision remains visible")
        try check(ProgramPackageReviewPresentation(historical: approved, latest: approved).later == nil,
            "same package review is not duplicated as a later decision")
        let currentOnly = ProgramPackageReviewPresentation(historical: nil, latest: approved)
        try check(currentOnly.displayed?.packageReviewId == approved.packageReviewId && currentOnly.later == nil,
            "ordinary current detail displays its latest decision once")
        let historicalOnly = ProgramPackageReviewPresentation(historical: oldCorrection, latest: nil)
        try check(historicalOnly.displayed?.packageReviewId == oldCorrection.packageReviewId && historicalOnly.later == nil,
            "missing current decision does not hide historical decision")
        print("PASS \(count) offline package selection/navigation checks; no native runtime acceptance claimed")
    }
}
