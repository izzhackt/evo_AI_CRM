import Foundation
import Supabase

extension SupabaseService {
    func applicationPackageReadiness(studentCaseId: UUID, applicationId: UUID,
        selections: [ApplicationPackageSelectionItem] = []) async throws -> ApplicationPackageReadiness {
        let value: ApplicationPackageReadiness = try await client.rpc("application_package_readiness_v1", params: ApplicationDocumentJSON.object([
            "p_student_case_id": .string(studentCaseId.uuidString.lowercased()), "p_application_id": .string(applicationId.uuidString.lowercased()),
            "p_selections": .array(try selections.map { try $0.raw })
        ])).execute().value
        try value.validate(studentCaseId: studentCaseId.uuidString.lowercased(), applicationId: applicationId.uuidString.lowercased())
        try ApplicationPackageWire.require(value.selections.map(\.item) == selections)
        return value
    }
    func submitApplicationPackage(_ intent: ApplicationPackageSubmitIntent) async throws -> ApplicationPackageSubmitReceipt {
        let value: ApplicationPackageSubmitReceipt = try await client.rpc("application_package_submit_v1", params: intent.parameters()).execute().value
        try value.validate(intent); return value
    }
    func reviewApplicationPackage(_ intent: ApplicationPackageReviewIntent) async throws -> ApplicationPackageReviewReceipt {
        let value: ApplicationPackageReviewReceipt = try await client.rpc("application_package_review_v1", params: intent.parameters()).execute().value
        try value.validate(intent); return value
    }
    func recoverApplicationPackage<Intent: ApplicationPackagePersistedIntent>(_ intent: Intent) async throws -> Data {
        // The caller validates the correlated recovery before resolving pending.
        let value: ApplicationDocumentJSON = try await client.rpc("application_package_recover_v1", params: intent.recoveryParameters()).execute().value
        return try JSONEncoder().encode(value)
    }
    func applicationPackageDetail(studentCaseId: UUID, applicationId: UUID, packageId: String) async throws -> ApplicationPackageDetail {
        let value: ApplicationPackageDetail = try await client.rpc("application_package_detail_v1", params: ApplicationDocumentJSON.object([
            "p_student_case_id": .string(studentCaseId.uuidString.lowercased()), "p_application_id": .string(applicationId.uuidString.lowercased()), "p_package_id": .string(packageId)
        ])).execute().value
        try value.validate(studentCaseId: studentCaseId.uuidString.lowercased(), applicationId: applicationId.uuidString.lowercased(), packageId: packageId)
        return value
    }
    func applicationPackageHistory(studentCaseId: UUID, applicationId: UUID, cursor: ApplicationDocumentHistoryCursor? = nil) async throws -> ApplicationPackageHistory {
        let value: ApplicationPackageHistory = try await client.rpc("application_package_history_v1", params: packagePageParameters(studentCaseId: studentCaseId, applicationId: applicationId, cursor: cursor)).execute().value
        try value.validate(studentCaseId: studentCaseId.uuidString.lowercased(), applicationId: applicationId.uuidString.lowercased()); return value
    }
    func applicationPackageReviewHistory(studentCaseId: UUID, applicationId: UUID, packageId: String, cursor: ApplicationDocumentHistoryCursor? = nil) async throws -> ApplicationPackageReviewHistory {
        var params = try packagePageParameters(studentCaseId: studentCaseId, applicationId: applicationId, cursor: cursor).object("p_student_case_id p_application_id p_cursor p_limit")
        params["p_package_id"] = .string(packageId)
        let value: ApplicationPackageReviewHistory = try await client.rpc("application_package_review_history_v1", params: ApplicationDocumentJSON.object(params)).execute().value
        try value.validate(studentCaseId: studentCaseId.uuidString.lowercased(), applicationId: applicationId.uuidString.lowercased(), packageId: packageId); return value
    }
    func applicationPackageQueue(cursor: ApplicationDocumentHistoryCursor? = nil) async throws -> ApplicationPackageQueue {
        try await client.rpc("application_package_queue_v1", params: ApplicationDocumentJSON.object([
            "p_cursor": try packageCursor(cursor), "p_limit": .integer(20)
        ])).execute().value
    }
    func applicationPackageNotification(notificationId: UUID, studentCaseId: UUID) async throws -> ApplicationPackageNotification {
        let value: ApplicationPackageNotification = try await client.rpc("application_package_notification_v1", params: ApplicationDocumentJSON.object([
            "p_notification_id": .string(notificationId.uuidString.lowercased())
        ])).execute().value
        try value.validate(notificationId: notificationId.uuidString.lowercased(), studentCaseId: studentCaseId.uuidString.lowercased()); return value
    }
    private func packagePageParameters(studentCaseId: UUID, applicationId: UUID, cursor: ApplicationDocumentHistoryCursor?) throws -> ApplicationDocumentJSON {
        .object(["p_student_case_id": .string(studentCaseId.uuidString.lowercased()), "p_application_id": .string(applicationId.uuidString.lowercased()),
                 "p_cursor": try packageCursor(cursor), "p_limit": .integer(20)])
    }
    private func packageCursor(_ cursor: ApplicationDocumentHistoryCursor?) throws -> ApplicationDocumentJSON {
        try cursor.map { try JSONDecoder().decode(ApplicationDocumentJSON.self, from: JSONEncoder().encode($0)) } ?? .null
    }
}

func programPackageErrorKey(_ error: Error) -> String {
    if let error = error as? PostgrestError {
        if error.code == "42501" { return "package_access_unavailable" }
        if ["application_package_stale_requirements", "application_package_previous_package_changed", "application_package_previous_submission_changed"].contains(error.message) { return "package_changed" }
        if error.message == "application_package_not_ready" { return "package_not_ready" }
    }
    return "package_request_unknown"
}
