import SwiftUI

@MainActor
final class ProgramPackageModel: ObservableObject {
    @Published private(set) var readiness: ApplicationPackageReadiness?
    @Published private(set) var selection = ProgramPackageSelectionState()
    @Published private(set) var preview: ApplicationPackageReadiness?
    @Published private(set) var pending: ApplicationPackagePending<ApplicationPackageSubmitIntent>?
    @Published private(set) var receipt: ApplicationPackageSubmitReceipt?
    @Published private(set) var busy = false
    @Published private(set) var errorKey: String?
    @Published private(set) var storageAvailable = false
    private var context: ProgramPreparationContext?
    var scope: ProgramPreparationContext.Scope? { context?.scope }
    private var applicationId: UUID?
    private var readGeneration = 0
    private let service = SupabaseService.shared
    private var store: ApplicationPackagePendingStore?

    func deactivate() {
        readGeneration += 1; context = nil; applicationId = nil; readiness = nil; preview = nil
        selection = .init(); pending = nil; receipt = nil; errorKey = nil; storageAvailable = false; busy = false
    }
    func activate(_ value: ApplicationPackageReadiness, context: ProgramPreparationContext) {
        if self.context?.scope != context.scope || applicationId?.uuidString.lowercased() != value.applicationId { deactivate() }
        self.context = context; applicationId = UUID(uuidString: value.applicationId); readiness = value
        selection.observe(value); preview = nil; restore()
    }
    private var owner: ApplicationPackageOwner? { context.map { .init(actorId: $0.scope.actorId, membershipId: $0.scope.membershipId, organizationId: $0.scope.organizationId) } }
    private func restore() {
        guard let owner, let context, let applicationId else { return }
        do {
            if store == nil { store = try ApplicationPackagePendingStore() }
            pending = try store!.list(owner: owner, studentCaseId: context.scope.caseId.uuidString.lowercased(), applicationId: applicationId.uuidString.lowercased(), as: ApplicationPackageSubmitIntent.self).first
            storageAvailable = true
        } catch { storageAvailable = false; pending = nil; errorKey = "package_storage_unavailable" }
    }
    func include(_ itemId: String, value: Bool) { guard !busy, pending == nil else { return }; selection.include(itemId, value: value); preview = nil; errorKey = nil }
    func resetSelection() { guard !busy, pending == nil, let readiness else { return }; selection.reset(readiness); preview = nil; errorKey = nil }
    func choose(_ item: ApplicationDocumentItem, selection chosen: ApplicationDocumentSelection, file: ApplicationDocumentFileSummary, sourceScope: ProgramPreparationContext.Scope?) {
        guard !busy, pending == nil, sourceScope == scope, let readiness, readiness.documentItems.contains(where: { $0.id == item.id }),
              !selection.revisionChanged else { return }
        do { try selection.choose(item: item, selection: chosen, file: file); preview = nil; errorKey = nil }
        catch { errorKey = "package_changed" }
    }
    var canSubmit: Bool {
        guard let readiness, let preview, storageAvailable, pending == nil, !busy, !selection.revisionChanged else { return false }
        return preview.canSubmit && !selection.missingOptionalFile(in: readiness) && preview.selections.map(\.item) == selection.items(for: readiness)
    }
    func check(session: ProgramPreparationSession) async {
        guard !busy, let context, let applicationId, let readiness, !selection.revisionChanged else { return }
        let generation = session.generation; readGeneration += 1; let read = readGeneration
        guard session.matches(context, generation: generation) else { return }
        let items = selection.items(for: readiness)
        busy = true; errorKey = nil; preview = nil; receipt = nil
        defer { if read == readGeneration { busy = false } }
        do {
            let value = try await service.applicationPackageReadiness(studentCaseId: context.scope.caseId, applicationId: applicationId, selections: items)
            guard read == readGeneration, session.matches(context, generation: generation) else { return }
            self.readiness = value; selection.observe(value)
            if !selection.revisionChanged { preview = value }
        } catch { if read == readGeneration, session.matches(context, generation: generation) { errorKey = "package_preview_failed" } }
    }
    func submit(session: ProgramPreparationSession) async {
        guard canSubmit, let context, let applicationId, let owner, let store, let preview, let revision = preview.requirements.revision else { return }
        let generation = session.generation; let key = "package/" + applicationId.uuidString.lowercased()
        guard session.matches(context, generation: generation), session.begin(key) else { return }
        busy = true; errorKey = nil; receipt = nil
        defer { if session.matches(context, generation: generation) { busy = false }; session.finish(key, generation: generation) }
        do {
            let intent = try ApplicationPackageSubmitIntent(studentCaseId: context.scope.caseId.uuidString.lowercased(), applicationId: applicationId.uuidString.lowercased(),
                requirementsRevisionId: revision.revisionId.uuidString.lowercased(), expectedPreviousPackageId: preview.latestPackage?.packageId,
                items: preview.selections.map(\.item), requestId: UUID().uuidString.lowercased())
            let frozen = try store.freeze(owner: owner, intent: intent); restore()
            let received = try await service.submitApplicationPackage(frozen.intent)
            guard session.matches(context, generation: generation) else { return }
            try store.resolve(frozen, receipt: received); receipt = received; self.preview = nil; restore()
            session.requestRefresh()
        } catch {
            if session.matches(context, generation: generation) { errorKey = programPackageErrorKey(error); restore() }
        }
    }
}

@MainActor
final class ProgramPackageRecoveryModel: ObservableObject {
    @Published private(set) var pending: [ApplicationPackagePending<ApplicationPackageSubmitIntent>] = []
    @Published private(set) var metadata: [String: [ApplicationDocumentHistoryEntry]] = [:]
    @Published private(set) var busyRequest: String?
    @Published private(set) var loadingMetadata: Set<String> = []
    @Published private(set) var errorKey: String?
    @Published private(set) var noticeKey: String?
    @Published private(set) var receipt: ApplicationPackageSubmitReceipt?
    private var owner: ApplicationPackageOwner?
    private var store: ApplicationPackagePendingStore?
    private var generation = 0
    private let service = SupabaseService.shared

    func load(context: ProgramPreparationContext?) {
        generation += 1; pending = []; metadata = [:]; loadingMetadata = []; errorKey = nil; noticeKey = nil; receipt = nil; owner = nil; busyRequest = nil
        guard let context else { return }
        let current = ApplicationPackageOwner(actorId: context.scope.actorId, membershipId: context.scope.membershipId, organizationId: context.scope.organizationId)
        do { let store = try ApplicationPackagePendingStore(); self.store = store; pending = try store.list(owner: current, as: ApplicationPackageSubmitIntent.self); owner = current }
        catch { store = nil; errorKey = "package_storage_unavailable" }
    }
    func hasMetadata(_ value: ApplicationPackagePending<ApplicationPackageSubmitIntent>) -> Bool { metadata[value.intent.requestId]?.count == value.intent.items.count }
    func readMetadata(_ value: ApplicationPackagePending<ApplicationPackageSubmitIntent>, session: ProgramPreparationSession) async {
        guard value.owner == owner, let context = session.context,
              value.owner == ApplicationPackageOwner(actorId: context.scope.actorId, membershipId: context.scope.membershipId, organizationId: context.scope.organizationId),
              !loadingMetadata.contains(value.intent.requestId) else { return }
        let run = generation, sessionGeneration = session.generation, request = value.intent.requestId
        loadingMetadata.insert(request)
        defer { if generation == run { loadingMetadata.remove(request) } }
        do {
            var cursor: ApplicationDocumentHistoryCursor?; var found: [String: ApplicationDocumentHistoryEntry] = [:]
            // Bounded history search. Missing original metadata never permits a
            // blind retry; authoritative status recovery remains available.
            for _ in 0..<5 {
                let page = try await service.applicationDocumentHistory(studentCaseId: UUID(uuidString: value.intent.studentCaseId)!, applicationId: UUID(uuidString: value.intent.applicationId)!, cursor: cursor)
                guard generation == run, session.matches(context, generation: sessionGeneration), value.owner == owner else { return }
                for item in value.intent.items {
                    if let exact = page.events.first(where: { event in
                        guard event.requirementItemId == item.requirementItemId,
                              event.requirementsRevisionId == value.intent.requirementsRevisionId,
                              event.file.id == item.selection.documentVersionId else { return false }
                        switch item.selection.kind {
                        case "program_upload": return event.upload?.uploadContextId == item.selection.uploadContextId
                        case "existing_version": return true
                        default: return false
                        }
                    }) { found[item.requirementItemId] = exact }
                }
                if found.count == value.intent.items.count || page.nextCursor == nil { break }
                guard page.nextCursor != cursor else { throw ApplicationPackageClientError.invalidResponse }; cursor = page.nextCursor
            }
            metadata[request] = value.intent.items.compactMap { found[$0.requirementItemId] }
        } catch { if generation == run, session.matches(context, generation: sessionGeneration) { metadata[request] = [] } }
    }
    func resolve(_ value: ApplicationPackagePending<ApplicationPackageSubmitIntent>, retry: Bool, session: ProgramPreparationSession) async {
        guard busyRequest == nil, let owner, value.owner == owner, let store, let context = session.context,
              owner == ApplicationPackageOwner(actorId: context.scope.actorId, membershipId: context.scope.membershipId, organizationId: context.scope.organizationId),
              !retry || hasMetadata(value) else { return }
        let run = generation, sessionGeneration = session.generation, key = "package/" + value.intent.applicationId
        guard session.begin(key) else { return }
        busyRequest = value.intent.requestId; errorKey = nil; noticeKey = nil
        defer { if run == generation { busyRequest = nil }; session.finish(key, generation: sessionGeneration) }
        do {
            if retry {
                _ = try store.freeze(owner: owner, intent: value.intent)
                let result = try await service.submitApplicationPackage(value.intent)
                guard run == generation, session.matches(context, generation: sessionGeneration), self.owner == owner else { return }
                try store.resolve(value, receipt: result); receipt = result; noticeKey = "package_sent"
            } else {
                let result = try await service.recoverApplicationPackage(value.intent)
                guard run == generation, session.matches(context, generation: sessionGeneration), self.owner == owner else { return }
                switch try store.resolve(value, recoveryData: result) {
                case .submit(let received): receipt = received; noticeKey = "package_sent"
                case .notWritten: noticeKey = "package_not_written"
                case .review: throw ApplicationPackageClientError.invalidResponse
                }
            }
            pending = try store.list(owner: owner, as: ApplicationPackageSubmitIntent.self); session.requestRefresh()
        } catch { if run == generation, session.matches(context, generation: sessionGeneration) { errorKey = programPackageErrorKey(error) } }
    }
}
