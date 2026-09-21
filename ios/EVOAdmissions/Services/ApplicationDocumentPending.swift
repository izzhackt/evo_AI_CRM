import CryptoKit
import Foundation

struct ApplicationDocumentOwner: Codable, Equatable {
    let actorId: String
    let membershipId: String
    let organizationId: String
    let studentCaseId: String

    init(actorId: UUID, membershipId: UUID, organizationId: UUID, studentCaseId: UUID) {
        self.actorId = actorId.uuidString.lowercased()
        self.membershipId = membershipId.uuidString.lowercased()
        self.organizationId = organizationId.uuidString.lowercased()
        self.studentCaseId = studentCaseId.uuidString.lowercased()
    }
}

struct ApplicationDocumentPending<Intent: ApplicationDocumentPersistedIntent>: Codable, Equatable {
    let owner: ApplicationDocumentOwner
    let applicationId: String
    let requirementItemId: String
    let operation: String
    let requestId: String
    let intent: Intent
}

/// One file per owner/application/item/operation. Never enumerates another
/// account's requests; a corrupt/unwritable record blocks dispatch, not identity.
struct ApplicationDocumentPendingStore {
    private let directory: URL

    init(directory: URL? = nil) throws {
        if let directory { self.directory = directory }
        else {
            self.directory = try FileManager.default.url(for: .applicationSupportDirectory,
                in: .userDomainMask, appropriateFor: nil, create: true)
                .appending(path: "ProgramDocumentPending", directoryHint: .isDirectory)
        }
        try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        var resource = self.directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try resource.setResourceValues(values)
    }

    func load<Intent: ApplicationDocumentPersistedIntent>(owner: ApplicationDocumentOwner, applicationId: String,
        itemId: String, operation: String, as: Intent.Type) throws -> ApplicationDocumentPending<Intent>? {
        let url = try location(owner: owner, applicationId: applicationId, itemId: itemId, operation: operation)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let value = try JSONDecoder().decode(ApplicationDocumentPending<Intent>.self, from: Data(contentsOf: url))
        try value.intent.validate()
        guard value.intent.studentCaseId == owner.studentCaseId, value.intent.applicationId == applicationId,
              value.intent.requirementItemId == itemId, operation == Intent.operation,
              value.owner == owner, value.applicationId == applicationId, value.requirementItemId == itemId,
              value.operation == operation, ApplicationDocumentWire.uuid(value.requestId) else {
            throw ApplicationDocumentClientError.pendingUnavailable
        }
        return value
    }

    /// Called before obtaining a token or dispatching. A different new intent
    /// cannot overwrite a request whose result has not been resolved.
    func freeze<Intent: ApplicationDocumentPersistedIntent>(owner: ApplicationDocumentOwner, applicationId: String,
        itemId: String, operation: String, intent: Intent) throws -> ApplicationDocumentPending<Intent> {
        try intent.validate()
        guard intent.studentCaseId == owner.studentCaseId, intent.applicationId == applicationId,
              intent.requirementItemId == itemId, operation == Intent.operation else { throw ApplicationDocumentClientError.invalidIntent }
        if let existing = try load(owner: owner, applicationId: applicationId, itemId: itemId,
                                   operation: operation, as: Intent.self) {
            guard existing.intent == intent else { throw ApplicationDocumentClientError.changedFile }
            return existing
        }
        let value = ApplicationDocumentPending(owner: owner, applicationId: applicationId,
            requirementItemId: itemId, operation: operation, requestId: UUID().uuidString.lowercased(), intent: intent)
        let url = try location(owner: owner, applicationId: applicationId, itemId: itemId, operation: operation)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let bytes = try encoder.encode(value)
        try bytes.write(to: url, options: [.atomic, .completeFileProtection])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        guard try Data(contentsOf: url) == bytes else { throw ApplicationDocumentClientError.pendingUnavailable }
        return value
    }

    func clear<Intent: ApplicationDocumentPersistedIntent>(_ value: ApplicationDocumentPending<Intent>) throws {
        let current = try load(owner: value.owner, applicationId: value.applicationId,
            itemId: value.requirementItemId, operation: value.operation, as: Intent.self)
        guard current == value else { throw ApplicationDocumentClientError.pendingUnavailable }
        try FileManager.default.removeItem(at: location(owner: value.owner, applicationId: value.applicationId,
            itemId: value.requirementItemId, operation: value.operation))
    }

    private func location(owner: ApplicationDocumentOwner, applicationId: String,
                          itemId: String, operation: String) throws -> URL {
        let parts = [owner.actorId, owner.membershipId, owner.organizationId, owner.studentCaseId, applicationId, itemId]
        guard parts.allSatisfy(ApplicationDocumentWire.uuid), ["upload", "submit"].contains(operation) else {
            throw ApplicationDocumentClientError.invalidIntent
        }
        let scope = (parts + [operation]).joined(separator: "/")
        let digest = SHA256.hash(data: Data(scope.utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appending(path: digest + ".json")
    }
}

extension ApplicationDocumentPendingStore {
    /// Enumerates only this app's metadata records, then requires the complete
    /// current actor/membership/organization/case scope before exposing a row.
    func list<Intent: ApplicationDocumentPersistedIntent>(owner: ApplicationDocumentOwner, applicationId: String,
        operation: String, as: Intent.Type) throws -> [ApplicationDocumentPending<Intent>] {
        let urls = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        var result: [ApplicationDocumentPending<Intent>] = []
        for url in urls where url.pathExtension == "json" {
            let bytes = try Data(contentsOf: url)
            // Other operation types need not decode as this intent. Inspect the
            // envelope scope before selecting the closed operation decoder.
            guard let header = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  header["operation"] as? String == operation,
                  header["applicationId"] as? String == applicationId,
                  let scope = header["owner"] as? [String: String],
                  scope == ["actorId": owner.actorId, "membershipId": owner.membershipId,
                            "organizationId": owner.organizationId, "studentCaseId": owner.studentCaseId] else { continue }
            let value = try JSONDecoder().decode(ApplicationDocumentPending<Intent>.self, from: bytes)
            try value.intent.validate()
            guard value.intent.studentCaseId == owner.studentCaseId, value.intent.applicationId == applicationId,
                  value.intent.requirementItemId == value.requirementItemId, operation == Intent.operation,
                  url.standardizedFileURL.path == (try location(owner: owner, applicationId: applicationId, itemId: value.requirementItemId, operation: operation)).standardizedFileURL.path,
                  ApplicationDocumentWire.uuid(value.requestId) else { throw ApplicationDocumentClientError.pendingUnavailable }
            result.append(value)
        }
        return result.sorted { $0.requirementItemId < $1.requirementItemId }
    }
}
