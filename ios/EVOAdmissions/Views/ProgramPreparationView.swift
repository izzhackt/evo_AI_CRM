import SwiftUI

struct ProgramPreparationRoute: Hashable {
    let applicationId: UUID
    var savedNotice = false
}

struct CatalogIntakePreparationAction: View {
    let item: UniversityCatalogItem
    let program: UniversityProgram
    let intake: UniversityIntake
    let snapshotIsFresh: Bool
    @ObservedObject var model: ProgramPreparationModel
    @EnvironmentObject private var session: ProgramPreparationSession
    let open: (ProgramPreparationRoute) -> Void

    var body: some View {
        if let context = session.context {
            if let existing = model.existing(institutionId: item.id, programId: program.id, intakeId: intake.id) {
                Button("prep_open") { open(ProgramPreparationRoute(applicationId: existing.id)) }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
            } else if context.canStart {
                if !["CN", "MY", "AE", "TR", "IT", "CZ"].contains(item.content.country) {
                    Text("prep_country_unavailable").font(.footnote).foregroundStyle(.secondary)
                } else if intake.id == nil {
                    Text("prep_identity_unavailable").font(.footnote).foregroundStyle(.secondary)
                } else if intake.status == "closed" {
                    Text("prep_intake_closed").font(.footnote).foregroundStyle(.secondary)
                } else {
                    Button {
                        Task {
                            if let id = await model.select(item: item, program: program, intake: intake,
                                                           context: context, session: session) {
                                open(ProgramPreparationRoute(applicationId: id, savedNotice: model.savedNotice))
                            }
                        }
                    } label: {
                        HStack {
                            if isThisWorking { ProgressView() }
                            Text(LocalizedStringKey(isThisWorking ? "prep_starting" : buttonKey))
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .fixedSize(horizontal: false, vertical: true)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color("AccentColor"))
                    .disabled(!snapshotIsFresh || !model.loaded || model.isWorking)
                    if !snapshotIsFresh {
                        Text("prep_refresh_catalog").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var buttonKey: String {
        guard let intakeId = intake.id else { return "prep_start" }
        let key = ProgramPreparationSession.selectionKey(institutionId: item.id, programId: program.id, intakeId: intakeId)
        return session.hasSelection(key) ? "prep_retry_selection" : "prep_start"
    }

    private var isThisWorking: Bool {
        guard let intakeId = intake.id else { return false }
        return model.workingSelectionKey == ProgramPreparationSession.selectionKey(
            institutionId: item.id, programId: program.id, intakeId: intakeId)
    }
}

/// Reads separately from AdmissionHub/Finance. A failed reader is never an
/// empty list, and already selected/terminal preparations remain openable.
struct ProgramPreparationListSection: View {
    @EnvironmentObject private var session: ProgramPreparationSession
    @StateObject private var model = ProgramPreparationModel()

    var body: some View {
        Section {
            if let context = session.context {
                if model.isLoading {
                    ProgressView("prep_loading")
                } else if model.loadFailed {
                    Text("prep_read_failed").foregroundStyle(.secondary)
                    Button("retry_button") { Task { await model.load(context: context) } }
                } else if model.loaded {
                    if model.items.isEmpty { Text("prep_empty").foregroundStyle(.secondary) }
                    ForEach(model.items) { preparation in
                        NavigationLink {
                            ProgramPreparationView(applicationId: preparation.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(preparation.selectedProgram?.title ?? preparation.content.name).font(.headline)
                                Text(preparation.content.name).font(.subheadline).foregroundStyle(.secondary)
                                if let intake = preparation.selectedIntake { Text(intake.label).font(.subheadline) }
                                Text(LocalizedStringKey("prep_status_\(preparation.applicationStatus.rawValue)"))
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
        } header: {
            Text("prep_list_title")
        }
        .task(id: session.context?.scope) {
            if let context = session.context { await model.load(context: context) }
        }
        .onChange(of: session.refreshSignal) {
            if let context = session.context { Task { await model.load(context: context) } }
        }
    }
}

struct ProgramPreparationView: View {
    let applicationId: UUID
    var initialSavedNotice = false
    @EnvironmentObject private var session: ProgramPreparationSession
    @StateObject private var model = ProgramPreparationDetailModel()

    private struct ReadTarget: Hashable {
        let scope: ProgramPreparationContext.Scope?
        let applicationId: UUID
    }

    var body: some View {
        List {
            if initialSavedNotice && model.requirements == nil {
                Section { Text("prep_choice_saved") }
            }
            if let preparation = model.preparation {
                Section {
                    Text(preparation.selectedProgram?.title ?? preparation.content.name)
                        .font(.headline).accessibilityAddTraits(.isHeader)
                    Text(preparation.content.name).font(.subheadline)
                    Text(LocalizedStringKey("prep_status_\(preparation.applicationStatus.rawValue)"))
                    if let intake = preparation.selectedIntake { UniversityIntakeView(intake: intake) }
                    if preparation.selection.deadlineStateAtSelection == .needsConfirmation {
                        Text("prep_deadline_confirmation").font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            if model.isLoading {
                Section { ProgressView("prep_loading") }
            } else if model.missing {
                Section { Text("prep_access_unavailable") }
            } else if model.readError {
                Section {
                    Text("prep_read_failed")
                    Button("retry_button") { Task { await refresh() } }
                }
            } else if let requirements = model.requirements {
                requirementsSection(requirements)
            }
            if let error = model.errorKey {
                Section { Text(LocalizedStringKey(error)).foregroundStyle(.red) }
            }
            if let requirements = model.requirements, requirements.state == .uninitialized,
               session.context?.canStart == true, model.preparation?.applicationStatus == .preparation {
                Section {
                    if initialSavedNotice { Text("prep_choice_saved") }
                    Button {
                        guard let context = session.context else { return }
                        Task {
                            await model.continuePreparation(applicationId: applicationId, context: context, session: session)
                        }
                    } label: {
                        HStack {
                            if model.isWorking { ProgressView() }
                            Text("prep_continue")
                        }.frame(minHeight: 44)
                    }
                    .disabled(model.isWorking || model.isLoading)
                }
            }
            Section {
                NavigationLink { AdmissionDocumentsView() } label: {
                    Label("prep_all_documents", systemImage: "doc.text")
                }
            } footer: {
                Text("prep_upload_sends")
            }
        }
        .navigationTitle("prep_detail_title")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: ReadTarget(scope: session.context?.scope, applicationId: applicationId)) { await refresh() }
        .refreshable { await refresh() }
    }

    private func refresh() async {
        guard let context = session.context else { return }
        await model.load(applicationId: applicationId, context: context)
    }

    @ViewBuilder
    private func requirementsSection(_ requirements: ApplicationRequirementsView) -> some View {
        Section {
            if requirements.state == .needsConfiguration {
                Text("prep_needs_configuration")
                NavigationLink { MessagesThreadView() } label: {
                    Label("messages_title", systemImage: "bubble.left.and.text.bubble.right")
                }
            } else if requirements.state == .uninitialized {
                Text("prep_not_initialized")
            }
            ForEach(requirements.items) { item in
                VStack(alignment: .leading, spacing: 8) {
                    Text(item.label).font(.headline).accessibilityAddTraits(.isHeader)
                    Text("prep_required").font(.caption).foregroundStyle(.secondary)
                    Text(item.instructions).font(.subheadline)
                    if let status = item.slotStatus {
                        Text(LocalizedStringKey("prep_slot_\(status.rawValue)"))
                            .font(.subheadline)
                    }
                    if let decision = item.reviewDecision {
                        Text(LocalizedStringKey("prep_review_\(decision.rawValue)"))
                            .font(.footnote)
                        if let reason = item.reviewReason { Text(reason).font(.footnote) }
                    }
                    if item.technicalAvailability == .available {
                        Text("prep_file_available").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        ForEach(item.unavailableReasons, id: \.rawValue) { reason in
                            Text(LocalizedStringKey("prep_file_\(reason.rawValue)"))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    if item.slotStatus != nil {
                        NavigationLink {
                            AdmissionDocumentsView(focusedSlotId: item.documentSlotId)
                        } label: {
                            Text("prep_open_document").frame(minHeight: 44)
                        }
                    }
                }.padding(.vertical, 4)
            }
        } header: {
            Text(LocalizedStringKey(requirements.revision == nil ? "prep_requirements_title" : "prep_starter_title"))
        } footer: {
            if requirements.revision != nil { Text("prep_starter_note") }
        }
    }
}
