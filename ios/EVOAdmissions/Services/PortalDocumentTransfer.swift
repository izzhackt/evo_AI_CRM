import Foundation

/// Bearer transport for the two document route handlers of the web cabinet
/// (ADR 0030 §3: the handlers stay as-is, a server-side actor resolver for
/// `Authorization: Bearer <access token>` is added as a cookie alternative —
/// built IN PARALLEL on izzhackt/portal-8-bearer-documents; this client is
/// written to that contract and its live path is honestly not-exercised
/// until PORT-8a merges and releases):
/// - POST `{base}/api/portal/document-slots/{slotId}/versions` —
///   multipart/form-data with EXACTLY one part named `file`
///   (src/lib/server/platform-document-storage-route-handlers.ts requires a
///   UUID `Idempotency-Key` header, line 1160; success is 201 with
///   `{document: {…}}`, lines 1461-1473);
/// - GET `{base}/api/portal/document-versions/{versionId}/download` — the
///   student policy answers 302 + Location to a short-lived signed URL
///   (route-handlers.ts:175-179, 1579-1594). The redirect goes to another
///   host, so the delegate below STRIPS Authorization before following it.
///
/// Idempotency mirrors the web `PortalDocumentControls`: the key is FROZEN
/// per attempt — a retry resends the SAME key (the server replays the same
/// reservation), while picking a different file or succeeding resets it.
enum PortalDocumentTransfer {
    /// Accepted upload types (web input accept= and the route's sniffer).
    static let allowedMimeTypes = ["application/pdf", "image/jpeg", "image/png"]
    /// 25 MB — the route's hard cap (413 above it; receipt validation in
    /// PortalDocumentControls.tsx:246 uses the same number).
    static let maxByteSize = 25 * 1024 * 1024

    // MARK: Receipt (route-handlers.ts:1461-1473, student audience)

    struct UploadReceipt: Decodable, Equatable {
        let document: UploadedDocument
    }

    struct UploadedDocument: Decodable, Equatable {
        let documentSlotId: UUID
        let documentVersionId: UUID
        let versionNumber: Int64
        let originalFilename: String
        let declaredMimeType: String
        let byteSize: Int64
    }

    // MARK: Failure mapping (mirror of uploadFailureMessage,
    // PortalDocumentControls.tsx:270-283)

    enum UploadFailure: Equatable {
        case badFile        // 400 / 415
        case forbidden      // 403
        case conflict       // 409
        case tooLarge       // 413
        case scanRejected   // 422
        case rateLimited    // 429
        case unavailable    // everything else
        case network        // transport error, no HTTP status
        case badReceipt     // 201 with an unusable body
    }

    static func failure(forStatus status: Int) -> UploadFailure {
        switch status {
        case 400, 415: return .badFile
        case 403: return .forbidden
        case 409: return .conflict
        case 413: return .tooLarge
        case 422: return .scanRejected
        case 429: return .rateLimited
        default: return .unavailable
        }
    }

    // MARK: Multipart body (pure, testable)

    /// Exactly one part named `file` — the web upload form rejects any other
    /// field (PortalDocumentControls.tsx:92-95) and the route reads only it.
    static func multipartBody(
        boundary: String,
        filename: String,
        mimeType: String,
        fileData: Data
    ) -> Data {
        // A filename with a quote or newline would corrupt the header line.
        let safeName = filename
            .replacingOccurrences(of: "\"", with: "_")
            .replacingOccurrences(of: "\r", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data(
            "Content-Disposition: form-data; name=\"file\"; filename=\"\(safeName)\"\r\n".utf8
        ))
        body.append(Data("Content-Type: \(mimeType)\r\n\r\n".utf8))
        body.append(fileData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return body
    }

    // MARK: Requests

    static func uploadRequest(
        baseURL: URL,
        documentSlotId: UUID,
        idempotencyKey: UUID,
        accessToken: String,
        boundary: String
    ) -> URLRequest {
        var url = baseURL
        url.append(path: "api/portal/document-slots")
        url.append(path: documentSlotId.uuidString.lowercased())
        url.append(path: "versions")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        // The handler requires a UUID key (route-handlers.ts:1160) and the
        // web freezes it per attempt — same contract here.
        request.setValue(
            idempotencyKey.uuidString.lowercased(),
            forHTTPHeaderField: "Idempotency-Key"
        )
        request.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        return request
    }

    static func downloadRequest(
        baseURL: URL,
        documentVersionId: UUID,
        accessToken: String
    ) -> URLRequest {
        var url = baseURL
        url.append(path: "api/portal/document-versions")
        url.append(path: documentVersionId.uuidString.lowercased())
        url.append(path: "download")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        return request
    }
}

/// Frozen-idempotency-key state machine of one upload control — the pure
/// policy behind the web's `uploadIdempotencyKeyRef`
/// (PortalDocumentControls.tsx:72, 99-101, 128, 163):
/// - the first attempt mints a key and FREEZES it;
/// - a retry of the same attempt reuses the frozen key (the server replays
///   the same reservation instead of creating a duplicate);
/// - choosing another file resets the key (a NEW upload, not a replay);
/// - success clears the key (the next upload is a new attempt).
struct DocumentUploadIdempotency: Equatable {
    private(set) var frozenKey: UUID?

    /// Key for the attempt that is about to start: the frozen one if a
    /// failed attempt is being retried, otherwise a fresh key that becomes
    /// frozen.
    mutating func keyForAttempt(minting mint: () -> UUID = UUID.init) -> UUID {
        if let frozenKey { return frozenKey }
        let key = mint()
        frozenKey = key
        return key
    }

    /// The user picked a different file — the previous attempt's key must
    /// NOT be replayed for new bytes (web: onChange clears the ref).
    mutating func fileChanged() {
        frozenKey = nil
    }

    /// 201 + verified receipt — the attempt is complete; the next upload is
    /// a brand-new command (web: ref set to null on success).
    mutating func uploadSucceeded() {
        frozenKey = nil
    }
}

/// URLSession delegate for the download redirect: the 302 Location points at
/// a signed storage URL on ANOTHER host — the Authorization header must not
/// leak there. URLSession would otherwise re-send original-request headers.
final class PortalDownloadRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        var sanitized = request
        if request.url?.host() != task.originalRequest?.url?.host() {
            sanitized.setValue(nil, forHTTPHeaderField: "Authorization")
        }
        completionHandler(sanitized)
    }
}
