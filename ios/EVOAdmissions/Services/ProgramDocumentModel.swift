import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class ProgramDocumentModel: ObservableObject {
    @Published private(set) var documents: ApplicationPackageReadiness?
    @Published private(set) var uploads: [ApplicationDocumentPending<ApplicationDocumentUploadIntent>] = []
    @Published private(set) var submits: [ApplicationDocumentPending<ApplicationDocumentSubmitIntent>] = []
    @Published private(set) var busy = false
    @Published private(set) var errorKey: String?
    @Published private(set) var noticeKey: String?
    @Published var previewURL: URL?
    private let service: SupabaseService
    private var context: ProgramPreparationContext?
    private var applicationId: UUID?
    private var store: ApplicationDocumentPendingStore?
    private var previewDirectory: URL?

    init(service: SupabaseService = .shared) { self.service = service }
    private var owner: ApplicationDocumentOwner? {
        context.map { ApplicationDocumentOwner(actorId: $0.scope.actorId, membershipId: $0.scope.membershipId,
            organizationId: $0.scope.organizationId, studentCaseId: $0.scope.caseId) }
    }
    func activate(_ view: ApplicationPackageReadiness, context: ProgramPreparationContext) {
        if self.context?.scope != context.scope || applicationId?.uuidString.lowercased() != view.applicationId {
            uploads = []; submits = []; clearPreview(); noticeKey = nil; errorKey = nil
        }
        self.context = context; applicationId = UUID(uuidString: view.applicationId); documents = view
        restore()
    }
    func beginRead(context: ProgramPreparationContext, applicationId: UUID) {
        if self.context?.scope != context.scope || self.applicationId != applicationId { deactivate() }
        self.context = context; self.applicationId = applicationId
        documents = nil
        restore()
    }
    func deactivate() { context = nil; applicationId = nil; documents = nil; uploads = []; submits = []; busy = false; errorKey = nil; noticeKey = nil; clearPreview() }
    private func clearPreview() {
        previewURL = nil
        if let previewDirectory { try? FileManager.default.removeItem(at: previewDirectory) }
        previewDirectory = nil
    }
    private func restore() {
        guard let owner, let applicationId else { return }
        do {
            if store == nil { store = try ApplicationDocumentPendingStore() }
            uploads = try store!.list(owner: owner, applicationId: applicationId.uuidString.lowercased(), operation: "upload", as: ApplicationDocumentUploadIntent.self)
            submits = try store!.list(owner: owner, applicationId: applicationId.uuidString.lowercased(), operation: "submit", as: ApplicationDocumentSubmitIntent.self)
            for pending in uploads { try pending.intent.validate() }
            for pending in submits { try pending.intent.validate() }
        } catch { errorKey = "program_document_pending_unavailable"; store = nil }
    }
    func pendingUpload(_ item: String) -> ApplicationDocumentPending<ApplicationDocumentUploadIntent>? { uploads.first { $0.requirementItemId == item } }
    func pendingSubmit(_ item: String) -> ApplicationDocumentPending<ApplicationDocumentSubmitIntent>? { submits.first { $0.requirementItemId == item } }
    var oldUploads: [ApplicationDocumentPending<ApplicationDocumentUploadIntent>] { uploads.filter { value in !((documents?.documentItems.contains { $0.id == value.requirementItemId }) ?? false) } }
    var oldSubmits: [ApplicationDocumentPending<ApplicationDocumentSubmitIntent>] { submits.filter { value in !((documents?.documentItems.contains { $0.id == value.requirementItemId }) ?? false) } }

    func saveFile(_ url: URL, itemId: String, session: ProgramPreparationSession) async {
        guard !busy, let context, let applicationId, let owner, let store else { errorKey = "program_document_pending_unavailable"; return }
        let generation = session.generation
        let lock = "document/\(applicationId)/\(itemId)"
        guard session.matches(context, generation: generation), session.begin(lock) else { return }
        busy = true; errorKey = nil; noticeKey = nil
        defer { if session.matches(context, generation: generation) { busy = false }; session.finish(lock, generation: generation) }
        do {
            let secured = url.startAccessingSecurityScopedResource()
            defer { if secured { url.stopAccessingSecurityScopedResource() } }
            let info = try url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey, .isRegularFileKey])
            guard info.isRegularFile == true, let size = info.fileSize, size > 0, size <= PortalDocumentTransfer.maxByteSize,
                  let mime = info.contentType?.preferredMIMEType, PortalDocumentTransfer.allowedMimeTypes.contains(mime) else { throw ApplicationDocumentClientError.invalidIntent }
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            guard let data = try handle.read(upToCount: PortalDocumentTransfer.maxByteSize + 1),
                  data.count == size, data.count <= PortalDocumentTransfer.maxByteSize else { throw ApplicationDocumentClientError.invalidIntent }
            let file = try ApplicationDocumentFile(originalFilename: url.lastPathComponent, declaredMimeType: mime, data: data)
            let intent: ApplicationDocumentUploadIntent
            if let pending = pendingUpload(itemId) {
                guard pending.intent.file == file else { throw ApplicationDocumentClientError.changedFile }
                intent = pending.intent
            } else {
                let fresh = try await service.applicationPackageReadiness(studentCaseId: context.scope.caseId, applicationId: applicationId)
                guard session.matches(context, generation: generation), let item = fresh.documentItems.first(where: { $0.id == itemId }), item.canUpload,
                      let revision = fresh.requirements.revision, let id = UUID(uuidString: itemId), let slotId = UUID(uuidString: item.documentSlotId) else { throw ProgramPreparationLocalError.unavailable }
                intent = try ApplicationDocumentUploadIntent(studentCaseId: context.scope.caseId, applicationId: applicationId,
                    requirementsRevisionId: revision.revisionId, requirementItemId: id, documentSlotId: slotId, file: file)
            }
            guard session.matches(context, generation: generation) else { return }
            let pending = try store.freeze(owner: owner, applicationId: intent.applicationId, itemId: itemId, operation: "upload", intent: intent)
            restore()
            let token = try await service.currentAccessToken()
            guard session.matches(context, generation: generation) else { return }
            let request = try ApplicationDocumentTransfer.uploadRequest(baseURL: AppConfig.portalWebBaseURL,
                intent: pending.intent, requestId: pending.requestId, accessToken: token, fileData: data, boundary: "evo-program-" + UUID().uuidString)
            let transport = URLSession(configuration: .ephemeral, delegate: PortalDownloadRedirectDelegate(), delegateQueue: nil)
            defer { transport.finishTasksAndInvalidate() }
            let (bytes, response) = try await transport.data(for: request)
            guard session.matches(context, generation: generation) else { return }
            guard (response as? HTTPURLResponse)?.statusCode == 201 else {
                let failure = try ApplicationDocumentHTTPFailure.decode(bytes)
                if failure.notWritten { try store.clear(pending); restore() }
                throw failure
            }
            _ = try ApplicationDocumentUploadReceipt.decodeEnvelope(bytes, intent: pending.intent, requestId: pending.requestId)
            try store.clear(pending)
            noticeKey = "program_document_saved"
            await refresh(context: context, applicationId: applicationId, generation: generation, session: session)
        } catch {
            if session.matches(context, generation: generation) {
                if let failure = error as? ApplicationDocumentHTTPFailure, failure.notWritten {
                    errorKey = "program_document_upload_not_saved"
                } else if let local = error as? ApplicationDocumentClientError, local == .changedFile {
                    errorKey = "program_document_same_file"
                } else if let local = error as? ApplicationDocumentClientError, local == .invalidIntent {
                    errorKey = "program_document_invalid_file"
                } else { errorKey = "program_document_request_unknown" }
                restore()
            }
        }
    }

    func submit(itemId: String, selection: ApplicationDocumentSelection?, session: ProgramPreparationSession) async {
        guard !busy, let context, let applicationId, let owner, let store else { errorKey = "program_document_pending_unavailable"; return }
        let generation = session.generation
        let lock = "document/\(applicationId)/\(itemId)"
        guard session.matches(context, generation: generation), session.begin(lock) else { return }
        busy = true; errorKey = nil; noticeKey = nil
        defer { if session.matches(context, generation: generation) { busy = false }; session.finish(lock, generation: generation) }
        do {
            let intent: ApplicationDocumentSubmitIntent
            if let pending = pendingSubmit(itemId) {
                guard selection == nil || selection == pending.intent.selection else { throw ApplicationDocumentClientError.changedFile }
                intent = pending.intent
            } else {
                guard let selection else { throw ApplicationDocumentClientError.invalidIntent }
                let fresh = try await service.applicationPackageReadiness(studentCaseId: context.scope.caseId, applicationId: applicationId)
                guard session.matches(context, generation: generation), let item = fresh.documentItems.first(where: { $0.id == itemId }), item.canSubmit,
                      let revision = fresh.requirements.revision else { throw ProgramPreparationLocalError.unavailable }
                intent = ApplicationDocumentSubmitIntent(studentCaseId: context.scope.caseId.uuidString.lowercased(), applicationId: fresh.applicationId,
                    requirementsRevisionId: revision.revisionId.uuidString.lowercased(), requirementItemId: itemId, documentSlotId: item.documentSlotId,
                    selection: selection, expectedPreviousSubmissionId: item.submission?.submissionId)
                try intent.validate()
            }
            guard session.matches(context, generation: generation) else { return }
            let pending = try store.freeze(owner: owner, applicationId: intent.applicationId, itemId: itemId, operation: "submit", intent: intent)
            restore()
            _ = try await service.submitApplicationDocument(pending.intent, requestId: pending.requestId)
            guard session.matches(context, generation: generation) else { return }
            try store.clear(pending)
            noticeKey = "program_document_sent"
            await refresh(context: context, applicationId: applicationId, generation: generation, session: session)
        } catch {
            if session.matches(context, generation: generation) {
                if let failure = error as? ApplicationDocumentDefinitiveFailure, let pending = pendingSubmit(itemId) {
                    do { try store.clear(pending); errorKey = failure.key }
                    catch { errorKey = "program_document_pending_unavailable" }
                    await refresh(context: context, applicationId: applicationId, generation: generation, session: session)
                } else { errorKey = "program_document_request_unknown" }
                restore()
            }
        }
    }
    private func refresh(context: ProgramPreparationContext, applicationId: UUID, generation: Int, session: ProgramPreparationSession) async {
        restore()
        do {
            let view = try await service.applicationPackageReadiness(studentCaseId: context.scope.caseId, applicationId: applicationId)
            if session.matches(context, generation: generation) { documents = view; session.requestRefresh() }
        } catch { if session.matches(context, generation: generation) { errorKey = "prep_read_failed" } }
    }

    func preview(file: ApplicationDocumentFileSummary, revisionId: String, itemId: String, slotId: String,
                 session: ProgramPreparationSession) async {
        guard !busy, let context, let applicationId else { return }
        let generation = session.generation
        guard session.matches(context, generation: generation) else { return }
        busy = true; errorKey = nil
        defer { if session.matches(context, generation: generation) { busy = false } }
        do {
            let token = try await service.currentAccessToken()
            guard session.matches(context, generation: generation) else { return }
            let request = try ApplicationDocumentTransfer.downloadRequest(baseURL: AppConfig.portalWebBaseURL,
                studentCaseId: context.scope.caseId.uuidString.lowercased(), applicationId: applicationId.uuidString.lowercased(),
                revisionId: revisionId, itemId: itemId, slotId: slotId, versionId: file.id, accessToken: token)
            let transport = URLSession(configuration: .ephemeral, delegate: PortalDownloadRedirectDelegate(), delegateQueue: nil)
            defer { transport.finishTasksAndInvalidate() }
            let (bytes, response) = try await transport.data(for: request)
            guard session.matches(context, generation: generation) else { return }
            guard (response as? HTTPURLResponse)?.statusCode == 200, file.file.matches(bytes) else { throw ApplicationDocumentClientError.invalidResponse }
            clearPreview()
            let dir = FileManager.default.temporaryDirectory.appending(path: "program-documents").appending(path: UUID().uuidString)
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let url = dir.appending(path: file.file.previewFilename)
            try bytes.write(to: url, options: [.atomic, .completeFileProtection])
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            previewDirectory = dir
            previewURL = url
        } catch { if session.matches(context, generation: generation) { errorKey = "program_document_download_failed" } }
    }
}
