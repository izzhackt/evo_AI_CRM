import CryptoKit
import Foundation

/// Account identity, never authorization. Case/application remain in the frozen
/// intent, allowing recovery discovery even after its queue row has disappeared.
struct ApplicationPackageOwner: Codable, Equatable {
    let actorId: String, membershipId: String, organizationId: String
    init(actorId: UUID, membershipId: UUID, organizationId: UUID) {
        self.actorId = actorId.uuidString.lowercased(); self.membershipId = membershipId.uuidString.lowercased()
        self.organizationId = organizationId.uuidString.lowercased()
    }
    fileprivate func validate() throws {
        try ApplicationPackageWire.require([actorId, membershipId, organizationId].allSatisfy(ApplicationDocumentWire.uuid))
    }
}

struct ApplicationPackagePending<Intent: ApplicationPackagePersistedIntent>: Codable, Equatable {
    let owner: ApplicationPackageOwner
    let operation: ApplicationPackageOperation
    let intent: Intent
}

/// Metadata-only protected files. The full intent already includes its request
/// UUID. No bytes, bearer tokens or server snapshots are persisted here.
struct ApplicationPackagePendingStore {
    private let directory: URL
    private static let lock = NSLock()

    init(directory: URL? = nil) throws {
        self.directory = try directory ?? FileManager.default.url(for: .applicationSupportDirectory,
            in: .userDomainMask, appropriateFor: nil, create: true).appending(path: "ProgramPackagePending", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var resource = self.directory; var values = URLResourceValues(); values.isExcludedFromBackup = true
        try resource.setResourceValues(values)
    }

    func freeze<Intent: ApplicationPackagePersistedIntent>(owner: ApplicationPackageOwner, intent: Intent) throws -> ApplicationPackagePending<Intent> {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try owner.validate(); try intent.validate()
        let value = ApplicationPackagePending(owner: owner, operation: Intent.operation, intent: intent)
        let url = try location(owner: owner, intent: intent)
        if let existing = try read(url, owner: owner, as: Intent.self) {
            guard existing == value else { throw ApplicationPackageClientError.unresolvedIntent }
            return existing
        }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let bytes = try encoder.encode(value)
        try bytes.write(to: url, options: [.atomic, .completeFileProtection])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        guard try Data(contentsOf: url) == bytes else { throw ApplicationPackageClientError.pendingUnavailable }
        return value
    }

    func load<Intent: ApplicationPackagePersistedIntent>(owner: ApplicationPackageOwner, intent: Intent) throws -> ApplicationPackagePending<Intent>? {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try intent.validate()
        return try read(location(owner: owner, intent: intent), owner: owner, as: Intent.self)
    }

    /// Only the current account's hashed directory is traversed. No unrelated
    /// account file is opened, including when a foreign file is corrupt.
    func list<Intent: ApplicationPackagePersistedIntent>(owner: ApplicationPackageOwner, studentCaseId: String? = nil,
        applicationId: String? = nil, as: Intent.Type) throws -> [ApplicationPackagePending<Intent>] {
        Self.lock.lock(); defer { Self.lock.unlock() }
        try owner.validate()
        try ApplicationPackageWire.require([studentCaseId, applicationId].compactMap { $0 }.allSatisfy(ApplicationDocumentWire.uuid))
        let folder = try ownerDirectory(owner)
        guard FileManager.default.fileExists(atPath: folder.path) else { return [] }
        let urls = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        var values: [ApplicationPackagePending<Intent>] = []
        for url in urls where url.lastPathComponent.hasPrefix(Intent.operation.rawValue + "-") && url.pathExtension == "json" {
            guard let value = try read(url, owner: owner, as: Intent.self) else { throw ApplicationPackageClientError.pendingUnavailable }
            if let studentCaseId, value.intent.studentCaseId != studentCaseId { continue }
            if let applicationId, value.intent.applicationId != applicationId { continue }
            values.append(value)
        }
        return values.sorted {
            [$0.intent.studentCaseId, $0.intent.applicationId, $0.intent.recoveryTargetId].lexicographicallyPrecedes([$1.intent.studentCaseId, $1.intent.applicationId, $1.intent.recoveryTargetId])
        }
    }

    /// A successful read/refresh or a mutation error is deliberately not a
    /// resolution. Call only with the corresponding command/recovery response.
    func resolve(_ pending: ApplicationPackagePending<ApplicationPackageSubmitIntent>, receipt: ApplicationPackageSubmitReceipt) throws {
        try receipt.validate(pending.intent); try clearResolved(pending)
    }
    func resolve(_ pending: ApplicationPackagePending<ApplicationPackageReviewIntent>, receipt: ApplicationPackageReviewReceipt) throws {
        try receipt.validate(pending.intent); try clearResolved(pending)
    }
    @discardableResult
    func resolve(_ pending: ApplicationPackagePending<ApplicationPackageSubmitIntent>, recoveryData: Data) throws -> ApplicationPackageRecovery {
        let result = try ApplicationPackageRecovery.decode(recoveryData, intent: pending.intent); try clearResolved(pending); return result
    }
    @discardableResult
    func resolve(_ pending: ApplicationPackagePending<ApplicationPackageReviewIntent>, recoveryData: Data) throws -> ApplicationPackageRecovery {
        let result = try ApplicationPackageRecovery.decode(recoveryData, intent: pending.intent); try clearResolved(pending); return result
    }

    private func clearResolved<Intent>(_ pending: ApplicationPackagePending<Intent>) throws {
        Self.lock.lock(); defer { Self.lock.unlock() }
        let url = try location(owner: pending.owner, intent: pending.intent)
        guard try read(url, owner: pending.owner, as: Intent.self) == pending else { throw ApplicationPackageClientError.pendingUnavailable }
        try FileManager.default.removeItem(at: url)
    }
    private func read<Intent: ApplicationPackagePersistedIntent>(_ url: URL, owner: ApplicationPackageOwner, as: Intent.Type) throws -> ApplicationPackagePending<Intent>? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let bytes = try Data(contentsOf: url)
        let raw = try JSONDecoder().decode(ApplicationDocumentJSON.self, from: bytes)
        let envelope = try raw.object("owner operation intent")
        _ = try envelope["owner"]!.object("actorId membershipId organizationId")
        let value = try JSONDecoder().decode(ApplicationPackagePending<Intent>.self, from: bytes)
        try value.intent.validate(); try value.owner.validate()
        guard value.owner == owner, value.operation == Intent.operation,
              url.standardizedFileURL.path == (try location(owner: owner, intent: value.intent)).standardizedFileURL.path else {
            throw ApplicationPackageClientError.pendingUnavailable
        }
        return value
    }
    private func ownerDirectory(_ owner: ApplicationPackageOwner) throws -> URL {
        try owner.validate()
        return directory.appending(path: digest([owner.actorId, owner.membershipId, owner.organizationId]), directoryHint: .isDirectory)
    }
    private func location<Intent: ApplicationPackagePersistedIntent>(owner: ApplicationPackageOwner, intent: Intent) throws -> URL {
        try intent.validate()
        let name = Intent.operation.rawValue + "-" + digest([intent.studentCaseId, intent.applicationId, intent.recoveryTargetId]) + ".json"
        return try ownerDirectory(owner).appending(path: name)
    }
    private func digest(_ values: [String]) -> String {
        SHA256.hash(data: Data(values.joined(separator: "/").utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Detached recovery data source; it never depends on a live queue or revision,
/// never dispatches automatically, and immediately drops rows on account change.
struct ApplicationPackageRecoveryInventory {
    private(set) var owner: ApplicationPackageOwner?
    private(set) var submissions: [ApplicationPackagePending<ApplicationPackageSubmitIntent>] = []
    private(set) var reviews: [ApplicationPackagePending<ApplicationPackageReviewIntent>] = []

    mutating func reset() { owner = nil; submissions = []; reviews = [] }
    mutating func refresh(owner: ApplicationPackageOwner, store: ApplicationPackagePendingStore) throws {
        reset()
        let submissions = try store.list(owner: owner, as: ApplicationPackageSubmitIntent.self)
        let reviews = try store.list(owner: owner, as: ApplicationPackageReviewIntent.self)
        self.owner = owner; self.submissions = submissions; self.reviews = reviews
    }
}
