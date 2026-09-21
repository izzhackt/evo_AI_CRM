import CryptoKit
import Foundation

enum ApplicationDocumentClientError: Error, Equatable {
    case invalidIntent, changedFile, pendingUnavailable, invalidResponse
}

/// Metadata only. File bytes and bearer tokens never enter persistent pending state.
struct ApplicationDocumentFile: Codable, Equatable {
    let originalFilename: String
    let declaredMimeType: String
    let byteSize: String
    let sha256Hex: String

    init(originalFilename: String, declaredMimeType: String, data: Data) throws {
        self.originalFilename = originalFilename
        self.declaredMimeType = declaredMimeType
        byteSize = String(data.count)
        sha256Hex = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        try validate()
    }

    func validate(allowLegacyFilename: Bool = false) throws {
        guard !originalFilename.trimmingCharacters(in: CharacterSet(charactersIn: " ")).isEmpty, originalFilename.unicodeScalars.count <= 255, originalFilename.utf8.count <= 1024,
              allowLegacyFilename || originalFilename == originalFilename.trimmingCharacters(in: ApplicationDocumentWire.trimCharacters),
              !originalFilename.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }),
              allowLegacyFilename || (!originalFilename.contains("/") && !originalFilename.contains("\\")),
              PortalDocumentTransfer.allowedMimeTypes.contains(declaredMimeType),
              ApplicationDocumentWire.matches(byteSize, "^[1-9][0-9]*$"),
              let count = Int(byteSize), count <= PortalDocumentTransfer.maxByteSize,
              ApplicationDocumentWire.matches(sha256Hex, "^[0-9a-f]{64}$") else {
            throw ApplicationDocumentClientError.invalidIntent
        }
    }

    /// Legacy names can contain path separators. They are display data only;
    /// a preview always receives this fixed MIME-derived local basename.
    var previewFilename: String {
        switch declaredMimeType {
        case "application/pdf": return "document.pdf"
        case "image/jpeg": return "document.jpg"
        default: return "document.png"
        }
    }

    func matches(_ data: Data) -> Bool {
        byteSize == String(data.count)
            && sha256Hex == SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

protocol ApplicationDocumentPersistedIntent: Codable, Equatable {
    static var operation: String { get }
    var studentCaseId: String { get }
    var applicationId: String { get }
    var requirementItemId: String { get }
    func validate() throws
}

struct ApplicationDocumentUploadIntent: ApplicationDocumentPersistedIntent {
    static let operation = "upload"
    let protocolVersion: Int
    let studentCaseId: String
    let applicationId: String
    let requirementsRevisionId: String
    let requirementItemId: String
    let documentSlotId: String
    let file: ApplicationDocumentFile

    init(studentCaseId: UUID, applicationId: UUID, requirementsRevisionId: UUID,
         requirementItemId: UUID, documentSlotId: UUID, file: ApplicationDocumentFile) throws {
        protocolVersion = 1
        self.studentCaseId = studentCaseId.uuidString.lowercased()
        self.applicationId = applicationId.uuidString.lowercased()
        self.requirementsRevisionId = requirementsRevisionId.uuidString.lowercased()
        self.requirementItemId = requirementItemId.uuidString.lowercased()
        self.documentSlotId = documentSlotId.uuidString.lowercased()
        self.file = file
        try validate()
    }

    func validate() throws {
        guard protocolVersion == 1,
              [studentCaseId, applicationId, requirementsRevisionId, requirementItemId, documentSlotId]
                .allSatisfy(ApplicationDocumentWire.uuid) else { throw ApplicationDocumentClientError.invalidIntent }
        try file.validate()
    }

    func headerValue() throws -> String {
        try validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let bytes = try encoder.encode(self)
        guard bytes.count <= 6144 else { throw ApplicationDocumentClientError.invalidIntent }
        let value = bytes.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        guard value.utf8.count <= 8192 else { throw ApplicationDocumentClientError.invalidIntent }
        return value
    }
}

enum ApplicationDocumentTransfer {
    /// A replay must supply the frozen metadata AND the same bytes. The route
    /// repeats this validation before replaying an already finalized upload.
    static func uploadRequest(baseURL: URL, intent: ApplicationDocumentUploadIntent,
                              requestId: String, accessToken: String, fileData: Data,
                              boundary: String) throws -> URLRequest {
        try intent.validate()
        guard ApplicationDocumentWire.uuid(requestId), intent.file.matches(fileData) else {
            throw ApplicationDocumentClientError.changedFile
        }
        var url = baseURL
        url.append(path: "api/portal/application-document-uploads")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue(requestId, forHTTPHeaderField: "Idempotency-Key")
        request.setValue(try intent.headerValue(), forHTTPHeaderField: "X-EVO-Upload-Intent")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = PortalDocumentTransfer.multipartBody(boundary: boundary, filename: "upload",
            mimeType: intent.file.declaredMimeType, fileData: fileData)
        return request
    }
}

enum ApplicationDocumentWire {
    static let trimCharacters = CharacterSet(charactersIn: "\u{0009}\u{000A}\u{000B}\u{000C}\u{000D}\u{0020}\u{0085}\u{00A0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}")
    static func uuid(_ value: String) -> Bool {
        matches(value, "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    }

    static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) == value.startIndex..<value.endIndex
    }
}

extension ApplicationDocumentTransfer {
    static func downloadRequest(baseURL: URL, studentCaseId: String, applicationId: String,
        revisionId: String, itemId: String, slotId: String, versionId: String, accessToken: String) throws -> URLRequest {
        let pairs = [("studentCaseId", studentCaseId), ("applicationId", applicationId), ("requirementsRevisionId", revisionId),
                     ("requirementItemId", itemId), ("documentSlotId", slotId), ("documentVersionId", versionId)]
        guard pairs.allSatisfy({ ApplicationDocumentWire.uuid($0.1) }) else { throw ApplicationDocumentClientError.invalidIntent }
        var components = URLComponents(url: baseURL.appending(path: "api/portal/application-document-downloads"), resolvingAgainstBaseURL: false)!
        components.queryItems = pairs.map { URLQueryItem(name: $0.0, value: $0.1) }
        guard let url = components.url else { throw ApplicationDocumentClientError.invalidIntent }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        return request
    }
}
