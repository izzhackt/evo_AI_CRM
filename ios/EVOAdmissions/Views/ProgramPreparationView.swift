import SwiftUI
import QuickLook

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
    @Environment(\.locale) private var locale
    @StateObject private var model = ProgramPreparationDetailModel()
    @StateObject private var documentModel = ProgramDocumentModel()

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
            ProgramDocumentPendingSection(model: documentModel)
            if let error = documentModel.errorKey {
                Section { Text(LocalizedStringKey(error)).foregroundStyle(.red) }
            }
            if let notice = documentModel.noticeKey {
                Section { Text(LocalizedStringKey(notice)) }
            }
            if documentModel.busy { Section { ProgressView("prep_loading") } }
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
                            await refresh()
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
                NavigationLink { ProgramDocumentHistoryView(applicationId: applicationId, model: documentModel) } label: {
                    Label("program_document_history", systemImage: "clock.arrow.circlepath")
                }
                NavigationLink { AdmissionDocumentsView() } label: {
                    Label("prep_all_documents", systemImage: "doc.text")
                }
            } footer: {
                Text("prep_upload_sends")
            }
        }
        .quickLookPreview($documentModel.previewURL)
        .navigationTitle("prep_detail_title")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: ReadTarget(scope: session.context?.scope, applicationId: applicationId)) { await refresh() }
        .onChange(of: session.refreshSignal) { Task { await refresh() } }
        .refreshable { await refresh() }
    }

    private func refresh() async {
        guard let context = session.context else { documentModel.deactivate(); return }
        documentModel.beginRead(context: context, applicationId: applicationId)
        await model.load(applicationId: applicationId, context: context)
        if session.context?.scope == context.scope, let documents = model.documents { documentModel.activate(documents, context: context) }
    }

    @ViewBuilder
    private func requirementsSection(_ requirements: ApplicationRequirementsV2View) -> some View {
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
                    Text(LocalizedStringKey(item.required ? "prep_required" : "prep_optional"))
                        .font(.caption).foregroundStyle(.secondary)
                    Text(item.instructions).font(.subheadline)
                    if let deadline = item.deadline {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("prep_requirement_deadline").font(.subheadline)
                            Text(deadlineLabel(deadline)).font(.subheadline)
                            if let source = deadline.sourceUrl, let url = URL(string: source) {
                                Link("prep_deadline_source", destination: url)
                                    .font(.footnote).frame(minHeight: 44, alignment: .leading)
                            }
                            Text(String(localized: "prep_deadline_verified", locale: locale) + " "
                                 + (CatalogDate.dayLabel(from: deadline.verifiedOn, locale: locale) ?? deadline.verifiedOn))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    if item.definitionImpact == .changed {
                        Text("prep_definition_changed").font(.footnote)
                    }
                    if let document = documentModel.documents?.items.first(where: { $0.id == item.id.uuidString.lowercased() }),
                       let revision = requirements.revision {
                        ProgramDocumentControls(item: document, revisionId: revision.revisionId.uuidString.lowercased(),
                            applicationId: applicationId, model: documentModel)
                    }
                    ForEach(item.unavailableReasons.filter { ["slot_missing", "slot_removed", "application_link_missing", "slot_metadata_changed"].contains($0.rawValue) }, id: \.rawValue) { reason in
                        Text(LocalizedStringKey("prep_file_\(reason.rawValue)")).font(.footnote).foregroundStyle(.secondary)
                    }
                    if item.slotStatus != nil {
                        NavigationLink {
                            AdmissionDocumentsView(focusedSlotId: item.documentSlotId)
                        } label: {
                            Text("program_document_open_legacy").frame(minHeight: 44)
                        }
                    }
                }.padding(.vertical, 4)
            }
        } header: {
            Text(LocalizedStringKey(requirements.revision?.origin == .evoStarter ? "prep_starter_title" : "prep_requirements_title"))
        } footer: {
            if requirements.revision?.origin == .evoStarter { Text("prep_starter_note") }
            else if requirements.revision?.origin == .staffConfirmed { Text("prep_confirmed_note") }
        }
    }

    private func deadlineLabel(_ deadline: ApplicationRequirementDeadline) -> String {
        let day = CatalogDate.dayLabel(from: deadline.date, locale: locale) ?? deadline.date
        let time = deadline.time.map { ", \($0)" } ?? ""
        let timezone = deadline.timezone.map { " (\($0))" } ?? ""
        return day + time + timezone
    }
}
