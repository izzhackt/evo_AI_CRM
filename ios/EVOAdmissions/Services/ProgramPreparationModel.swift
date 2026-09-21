import SwiftUI

struct ProgramPreparationContext: Equatable {
    struct Scope: Hashable {
        let actorId: UUID
        let membershipId: UUID
        let organizationId: UUID
        let caseId: UUID
    }
    let scope: Scope
    let canStart: Bool

    init(_ session: SessionRouter.PortalSession) {
        scope = Scope(actorId: session.authority.authUserId,
                      membershipId: session.authority.membershipId,
                      organizationId: session.authority.organizationId,
                      caseId: session.portalCase.id)
        canStart = session.portalCase.caseState == "active" && session.portalCase.portalActivatedAt != nil
    }
}

/// Session memory only: no credentials, files or automatic dispatch. A changed
/// actor/case drops pending intentions; token refresh for the same scope does not.
@MainActor
final class ProgramPreparationSession: ObservableObject {
    @Published private(set) var context: ProgramPreparationContext?
    @Published private(set) var refreshSignal = 0
    private(set) var generation = 0
    private var selections: [String: CatalogPreparationIntent] = [:]
    private var requirements: [UUID: ApplicationRequirementsIntent] = [:]
    private var running: Set<String> = []

    func activate(_ value: ProgramPreparationContext) {
        if context?.scope != value.scope { reset() }
        context = value
    }

    func reset() {
        context = nil
        generation += 1
        selections.removeAll()
        requirements.removeAll()
        running.removeAll()
    }

    func matches(_ value: ProgramPreparationContext, generation: Int) -> Bool {
        context?.scope == value.scope && self.generation == generation
    }

    static func selectionKey(institutionId: UUID, programId: String, intakeId: String) -> String {
        "\(institutionId.uuidString)/\(programId)/\(intakeId)"
    }

    func hasSelection(_ key: String) -> Bool { selections[key] != nil }
    func begin(_ key: String) -> Bool { running.insert(key).inserted }
    func finish(_ key: String, generation: Int) {
        if self.generation == generation { running.remove(key) }
    }

    func selectionIntent(key: String, context: ProgramPreparationContext, item: UniversityCatalogItem,
                         programId: String, intakeId: String) throws -> CatalogPreparationIntent {
        if let existing = selections[key] { return existing }
        let intent = try CatalogPreparationIntent(studentCaseId: context.scope.caseId,
            institutionId: item.id, programId: programId, intakeId: intakeId,
            publicationVersion: item.version, requestId: UUID())
        selections[key] = intent
        return intent
    }

    func clearSelection(_ key: String) { selections.removeValue(forKey: key) }
    func requestRefresh() { refreshSignal += 1 }

    func requirementsIntent(context: ProgramPreparationContext, applicationId: UUID) throws -> ApplicationRequirementsIntent {
        if let existing = requirements[applicationId] { return existing }
        let intent = try ApplicationRequirementsIntent(studentCaseId: context.scope.caseId,
                                                       applicationId: applicationId, requestId: UUID())
        requirements[applicationId] = intent
        return intent
    }

    func clearRequirements(_ applicationId: UUID) { requirements.removeValue(forKey: applicationId) }
}

enum ProgramPreparationLocalError: Error { case unavailable, working }

/// Called only by explicit select/continue buttons, never by a reader or .task.
@MainActor
private func initializeProgramRequirements(
    preparation: CatalogPreparation, context: ProgramPreparationContext,
    session: ProgramPreparationSession, service: SupabaseService
) async throws {
    let generation = session.generation
    let key = "requirements/\(preparation.id.uuidString)"
    guard session.matches(context, generation: generation), session.begin(key) else {
        throw ProgramPreparationLocalError.working
    }
    defer { session.finish(key, generation: generation) }
    let current = try await service.studentApplicationRequirements(
        studentCaseId: context.scope.caseId, applicationId: preparation.id)
    guard session.matches(context, generation: generation) else { throw ProgramPreparationLocalError.unavailable }
    guard current.state == .uninitialized else { return }
    guard session.context?.canStart == true, preparation.applicationStatus == .preparation else { return }
    let intent = try session.requirementsIntent(context: context, applicationId: preparation.id)
    do {
        _ = try await service.initializeApplicationRequirements(intent)
        guard session.matches(context, generation: generation) else { throw ProgramPreparationLocalError.unavailable }
        session.clearRequirements(preparation.id)
    } catch let error as ApplicationRequirementsFailure {
        if session.matches(context, generation: generation) { session.clearRequirements(preparation.id) }
        throw error
    }
}

@MainActor
final class ProgramPreparationModel: ObservableObject {
    @Published private(set) var items: [CatalogPreparation] = []
    @Published private(set) var isLoading = false
    @Published private(set) var loaded = false
    @Published private(set) var loadFailed = false
    @Published private(set) var isWorking = false
    @Published private(set) var workingSelectionKey: String?
    @Published private(set) var errorKey: String?
    @Published private(set) var savedNotice = false
    private let service: SupabaseService
    private var scope: ProgramPreparationContext.Scope?
    private var readGeneration = 0

    init(service: SupabaseService = .shared) { self.service = service }

    func load(context: ProgramPreparationContext) async {
        readGeneration += 1
        let generation = readGeneration
        if scope != context.scope { items = []; scope = context.scope }
        loaded = false
        loadFailed = false
        isLoading = true
        defer { if generation == readGeneration { isLoading = false } }
        do {
            let values = try await service.studentCatalogPreparations(studentCaseId: context.scope.caseId)
            guard generation == readGeneration else { return }
            items = values
            loaded = true
        } catch {
            if generation == readGeneration { loadFailed = true }
        }
    }

    func existing(institutionId: UUID, programId: String, intakeId: String?) -> CatalogPreparation? {
        guard loaded, let intakeId else { return nil }
        return items.first {
            $0.selection.institutionId == institutionId && $0.selection.programId == programId
                && $0.selection.intakeId == intakeId
        }
    }

    func select(item: UniversityCatalogItem, program: UniversityProgram, intake: UniversityIntake,
                context: ProgramPreparationContext, session: ProgramPreparationSession) async -> UUID? {
        guard !isWorking, loaded, scope == context.scope, context.canStart, let intakeId = intake.id else { return nil }
        let generation = session.generation
        let key = ProgramPreparationSession.selectionKey(institutionId: item.id, programId: program.id, intakeId: intakeId)
        guard session.matches(context, generation: generation), session.begin(key) else { return nil }
        isWorking = true
        workingSelectionKey = key
        errorKey = nil
        savedNotice = false
        defer { isWorking = false; workingSelectionKey = nil; session.finish(key, generation: generation) }
        var savedApplicationId: UUID?
        do {
            // Reconcile immediately before minting/sending: another screen or
            // employee may already have selected this exact programme/intake.
            await load(context: context)
            guard session.matches(context, generation: generation), loaded else {
                throw ProgramPreparationLocalError.unavailable
            }
            if let existing = existing(institutionId: item.id, programId: program.id, intakeId: intakeId) {
                return existing.id
            }
            if !session.hasSelection(key) {
                guard let fresh = try await service.studentUniversityCard(institutionId: item.id),
                      fresh.version == item.version else { throw CatalogPreparationFailure.stalePublication }
                guard session.matches(context, generation: generation) else { return nil }
            }
            let intent = try session.selectionIntent(key: key, context: context, item: item,
                                                     programId: program.id, intakeId: intakeId)
            let receipt = try await service.selectCatalogIntake(intent)
            guard session.matches(context, generation: generation) else { return nil }
            savedApplicationId = receipt.selection.applicationId
            session.clearSelection(key)
            session.requestRefresh()
            await load(context: context)
            guard session.matches(context, generation: generation) else { return nil }
            guard loaded, let preparation = items.first(where: { $0.id == receipt.selection.applicationId }) else {
                throw ProgramPreparationLocalError.unavailable
            }
            try await initializeProgramRequirements(preparation: preparation, context: context,
                                                    session: session, service: service)
            return preparation.id
        } catch {
            guard session.matches(context, generation: generation) else { return nil }
            if error is CatalogPreparationFailure { session.clearSelection(key) }
            errorKey = programPreparationErrorKey(error)
            savedNotice = savedApplicationId != nil
            return savedApplicationId
        }
    }
}

@MainActor
final class ProgramPreparationDetailModel: ObservableObject {
    @Published private(set) var preparation: CatalogPreparation?
    @Published private(set) var requirements: ApplicationRequirementsV2View?
    @Published private(set) var isLoading = false
    @Published private(set) var isWorking = false
    @Published private(set) var readError = false
    @Published private(set) var missing = false
    @Published private(set) var errorKey: String?
    private let service: SupabaseService
    private var readGeneration = 0
    private var target: UUID?

    init(service: SupabaseService = .shared) { self.service = service }

    func load(applicationId: UUID, context: ProgramPreparationContext) async {
        readGeneration += 1
        let generation = readGeneration
        if target != applicationId { preparation = nil; target = applicationId }
        isLoading = true
        readError = false
        missing = false
        requirements = nil
        defer { if generation == readGeneration { isLoading = false } }
        do {
            let rows = try await service.studentCatalogPreparations(studentCaseId: context.scope.caseId)
            guard generation == readGeneration else { return }
            guard let row = rows.first(where: { $0.id == applicationId }) else {
                preparation = nil; missing = true; return
            }
            preparation = row
            let view = try await service.studentApplicationRequirements(studentCaseId: context.scope.caseId, applicationId: applicationId)
            guard generation == readGeneration else { return }
            requirements = view
        } catch {
            if generation == readGeneration { readError = true }
        }
    }

    func continuePreparation(applicationId: UUID, context: ProgramPreparationContext,
                             session: ProgramPreparationSession) async {
        guard !isWorking else { return }
        isWorking = true
        errorKey = nil
        defer { isWorking = false }
        let generation = session.generation
        do {
            // Fresh current status before an explicit command; opening a saved
            // terminal application never initializes or changes it.
            await load(applicationId: applicationId, context: context)
            guard session.matches(context, generation: generation), !readError, let preparation else {
                throw ProgramPreparationLocalError.unavailable
            }
            try await initializeProgramRequirements(preparation: preparation, context: context,
                                                    session: session, service: service)
            if session.matches(context, generation: generation) { await load(applicationId: applicationId, context: context) }
        } catch {
            if session.matches(context, generation: generation) { errorKey = programPreparationErrorKey(error) }
        }
    }
}

func programPreparationErrorKey(_ error: Error) -> String {
    if let failure = error as? CatalogPreparationFailure {
        switch failure {
        case .caseIneligible: return "prep_case_ineligible"
        case .stalePublication, .programUnavailable, .intakeUnavailable, .intakeIdentityRequired: return "prep_refresh_catalog"
        case .unsupportedCountry: return "prep_country_unavailable"
        case .intakeClosed, .intakeExpired: return "prep_intake_closed"
        case .forbidden: return "prep_access_unavailable"
        case .invalidIntent, .requestConflict: return "prep_request_conflict"
        }
    }
    if let failure = error as? ApplicationRequirementsFailure {
        switch failure {
        case .caseIneligible, .applicationIneligible: return "prep_case_ineligible"
        case .needsConfiguration, .invariantConflict: return "prep_needs_configuration"
        case .forbidden: return "prep_access_unavailable"
        case .invalidIntent, .requestConflict: return "prep_request_conflict"
        }
    }
    return "prep_request_unconfirmed"
}

extension CatalogPreparation {
    var selectedProgram: UniversityProgram? { content.programs.first { $0.id == selection.programId } }
    var selectedIntake: UniversityIntake? { selectedProgram?.intakes.first { $0.id == selection.intakeId } }
}
