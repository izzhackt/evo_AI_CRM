import Foundation

/// PORT-9a: request builders for the two intake route handlers of the web
/// cabinet (PortalDocumentTransfer style — pure and testable):
/// - POST `{base}/api/portal/registration` — anonymous JSON
///   `{questionnaire, email, password}`; answers `{status}` in the
///   StudentSignupState vocabulary (201/400/409/429/503);
/// - POST `{base}/api/portal/invite-acceptance` — bearer-only; answers
///   `{status:"accepted", intakeFlow, accountPending, displayName}` on 200,
///   `{status}` on 401/409/503.
enum ApplicationIntakeTransfer {
    static func registrationRequest(
        baseURL: URL,
        payload: StudentRegistrationPayload
    ) throws -> URLRequest {
        var url = baseURL
        url.append(path: "api/portal/registration")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(payload)
        return request
    }

    static func inviteAcceptanceRequest(
        baseURL: URL,
        accessToken: String
    ) -> URLRequest {
        var url = baseURL
        url.append(path: "api/portal/invite-acceptance")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        return request
    }
}
