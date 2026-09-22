import SwiftUI

struct ProgramPackageSection: View {
    let applicationId: UUID
    @ObservedObject var model: ProgramPackageModel
    @EnvironmentObject private var session: ProgramPreparationSession
    @State private var showingPreview = false
    var body: some View {
        Section {
            if let ready = model.readiness {
                if ready.requirements.revision?.origin == .evoStarter { Text("package_starter_note").font(.footnote).foregroundStyle(.secondary) }
                if let latest = ready.latestPackage {
                    NavigationLink { ProgramPackageDetailView(applicationId: applicationId, packageId: latest.packageId) } label: { ProgramPackageSummaryLabel(package: latest) }
                }
                if model.pending != nil {
                    Text("package_pending_help").font(.footnote)
                    NavigationLink("package_recovery_title") { ProgramPackageRecoveryView() }.frame(minHeight: 44)
                } else if model.selection.revisionChanged {
                    Text("package_revision_changed").font(.footnote)
                    ForEach(model.selection.choices.keys.sorted(), id: \.self) { key in
                        if let choice = model.selection.choices[key] { ProgramDocumentFileLabel(file: choice.file) }
                    }
                    Button("package_reset_selection") { model.resetSelection() }.frame(minHeight: 44)
                } else {
                    ForEach(ready.requirements.items) { requirement in
                        if let item = ready.documentItems.first(where: { $0.id == requirement.id.uuidString.lowercased() }) {
                            ProgramPackageChoiceRow(applicationId: applicationId, requirement: requirement, item: item, sourceScope: model.scope, model: model)
                        }
                    }
                    Button("package_preview") { showingPreview = true; Task { await model.check(session: session) } }
                        .frame(minHeight: 44).disabled(model.busy || !model.storageAvailable || ready.requirements.revision == nil)
                }
                if let receipt = model.receipt {
                    Text("package_sent").font(.headline)
                    ProgramPackageTimestamp(raw: receipt.submittedAt)
                    NavigationLink("package_open_sent") { ProgramPackageDetailView(applicationId: applicationId, packageId: receipt.packageId) }.frame(minHeight: 44)
                }
                NavigationLink("package_history") { ProgramPackageHistoryView(applicationId: applicationId) }.frame(minHeight: 44)
            }
            if let error = model.errorKey { Text(LocalizedStringKey(error)).foregroundStyle(.red) }
        } header: { Text("package_title") } footer: { Text("package_help") }
        .sheet(isPresented: $showingPreview) {
            NavigationStack { ProgramPackagePreviewView(model: model) }
        }
    }
}

private struct ProgramPackageChoiceRow: View {
    let applicationId: UUID, requirement: ApplicationRequirementV2Item, item: ApplicationDocumentItem
    let sourceScope: ProgramPreparationContext.Scope?
    @ObservedObject var model: ProgramPackageModel
    private var included: Bool { requirement.required || model.selection.includedOptional.contains(item.id) }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(requirement.label).font(.headline)
            if requirement.required { Text("prep_required").font(.caption).foregroundStyle(.secondary) }
            else {
                Toggle("package_include_optional", isOn: Binding(get: { included }, set: { model.include(item.id, value: $0) })).frame(minHeight: 44)
            }
            if included {
                if let choice = model.selection.choices[item.id] {
                    ProgramDocumentFileLabel(file: choice.file)
                    Text("package_choice_retained").font(.footnote).foregroundStyle(.secondary)
                } else { Text("package_choose_file").font(.subheadline).foregroundStyle(.secondary) }
                if let submission = item.submission {
                    Button("package_choose_submission") {
                        model.choose(item, selection: .init(kind: "existing_version", documentVersionId: submission.file.id), file: submission.file, sourceScope: sourceScope)
                    }.frame(minHeight: 44).disabled(submission.file.technicalAvailability != .available)
                }
                if let draft = item.savedDraft {
                    Button("package_choose_saved") {
                        model.choose(item, selection: .init(kind: "program_upload", documentVersionId: draft.file.id, uploadContextId: draft.uploadContextId), file: draft.file, sourceScope: sourceScope)
                    }.frame(minHeight: 44).disabled(draft.file.technicalAvailability != .available)
                }
                NavigationLink {
                    ProgramDocumentReusablePicker(applicationId: applicationId, itemId: item.id) { model.choose(item, selection: $0.selection, file: $0.file, sourceScope: sourceScope) }
                } label: { Text("package_choose_version").frame(minHeight: 44) }
            }
        }.padding(.vertical, 4).disabled(model.busy || !model.storageAvailable)
    }
}

private struct ProgramPackagePreviewView: View {
    @ObservedObject var model: ProgramPackageModel
    @EnvironmentObject private var session: ProgramPreparationSession
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        List {
            if model.scope == session.context?.scope, session.context != nil {
            if model.busy { ProgressView("prep_loading") }
            if let ready = model.preview {
                if ready.requirements.revision?.origin == .evoStarter { Text("package_starter_note").font(.footnote) }
                Section {
                    ForEach(ready.selections, id: \.item.requirementItemId) { selected in
                        VStack(alignment: .leading, spacing: 6) {
                            if let requirement = ready.requirements.items.first(where: { $0.id.uuidString.lowercased() == selected.item.requirementItemId }) {
                                ProgramPackageRequirementDetails(label: requirement.label, groupLabel: requirement.groupLabel,
                                    required: requirement.required, instructions: requirement.instructions, deadline: requirement.deadline)
                            }
                            if let file = selected.file { ProgramDocumentFileLabel(file: file) }
                            ForEach(selected.reasons, id: \.rawValue) { Text(LocalizedStringKey("package_reason_\($0.rawValue)")).font(.footnote) }
                        }.padding(.vertical, 4)
                    }
                    if ready.selections.isEmpty { Text("package_empty_composition") }
                } header: { Text("package_selected_composition") }
                if !ready.missingRequiredItemIds.isEmpty {
                    Section {
                        ForEach(ready.missingRequiredItemIds, id: \.self) { id in
                            Text(ready.requirements.items.first { $0.id.uuidString.lowercased() == id }?.label ?? String(localized: "package_document"))
                        }
                    } header: { Text("package_missing_required") }
                }
                if model.selection.missingOptionalFile(in: ready) { Text("package_optional_missing_file").font(.footnote) }
                ForEach(ready.reasons, id: \.rawValue) { Text(LocalizedStringKey("package_reason_\($0.rawValue)")).font(.footnote) }
                Button("package_submit") {
                    Task { await model.submit(session: session); if model.receipt != nil { dismiss() } }
                }.buttonStyle(.borderedProminent).frame(minHeight: 44).disabled(!model.canSubmit)
                Text("package_help").font(.footnote).foregroundStyle(.secondary)
            }
            if let error = model.errorKey { Text(LocalizedStringKey(error)).foregroundStyle(.red) }
            if model.pending != nil { Text("package_pending_help").font(.footnote) }
            else if !model.busy && model.preview == nil {
                Button("retry_button") { Task { await model.check(session: session) } }.frame(minHeight: 44)
            }
            }
        }
        .navigationTitle("package_preview").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("package_close") { dismiss() }.disabled(model.busy) } }
        .interactiveDismissDisabled(model.busy)
    }
}

struct ProgramPackageRecoveryView: View {
    @EnvironmentObject private var session: ProgramPreparationSession
    @StateObject private var model = ProgramPackageRecoveryModel()
    @State private var visibleScope: ProgramPreparationContext.Scope?
    var body: some View {
        List {
            if visibleScope == session.context?.scope {
                Text("package_recovery_help").font(.footnote)
                if model.pending.isEmpty && model.errorKey == nil { Text("package_recovery_empty") }
                ForEach(model.pending, id: \.intent.requestId) { pending in
                    Section {
                        if let events = model.metadata[pending.intent.requestId], !events.isEmpty {
                            ForEach(events) { event in
                                VStack(alignment: .leading, spacing: 4) {
                                    ProgramPackageDefinitionView(definition: event.definition, material: event.materialSnapshot)
                                    ProgramDocumentFileLabel(file: event.file)
                                }
                            }
                        }
                        if model.loadingMetadata.contains(pending.intent.requestId) { ProgressView("prep_loading") }
                        else if !model.hasMetadata(pending) { Text("package_metadata_unavailable").font(.footnote) }
                        Button("package_check_status") { Task { await model.resolve(pending, retry: false, session: session) } }.frame(minHeight: 44)
                        if model.hasMetadata(pending) {
                            Button("package_retry_same") { Task { await model.resolve(pending, retry: true, session: session) } }.frame(minHeight: 44)
                        }
                        NavigationLink("program_document_open_program") { ProgramPreparationView(applicationId: UUID(uuidString: pending.intent.applicationId)!) }.frame(minHeight: 44)
                        if model.busyRequest == pending.intent.requestId { ProgressView("prep_loading") }
                    } header: { Text("package_pending_submission") }
                    .disabled(model.busyRequest != nil)
                    .task(id: pending.intent.requestId) { await model.readMetadata(pending, session: session) }
                }
                if let notice = model.noticeKey { Text(LocalizedStringKey(notice)) }
                if let receipt = model.receipt {
                    NavigationLink("package_open_sent") { ProgramPackageDetailView(applicationId: UUID(uuidString: receipt.applicationId)!, packageId: receipt.packageId) }.frame(minHeight: 44)
                }
                if let error = model.errorKey { Text(LocalizedStringKey(error)).foregroundStyle(.red) }
                Button("package_reload_pending") { model.load(context: session.context) }.frame(minHeight: 44).disabled(model.busyRequest != nil)
            }
        }
        .navigationTitle("package_recovery_title").navigationBarTitleDisplayMode(.inline)
        .task(id: session.context?.scope) { visibleScope = session.context?.scope; model.load(context: session.context) }
    }
}

struct ProgramPackageTimestamp: View {
    let raw: String
    @Environment(\.locale) private var locale
    var body: some View {
        Text(PostgresTimestamp.date(from: raw)?.formatted(.dateTime.day().month().year().hour().minute().locale(locale)) ?? raw)
            .font(.footnote).foregroundStyle(.secondary)
    }
}
struct ProgramPackageSummaryLabel: View {
    let package: ApplicationPackageSummary
    var review: ApplicationPackageReview? = nil
    @Environment(\.locale) private var locale
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(String(localized: "package_version", locale: locale) + " " + package.packageVersion).font(.headline)
            Text(LocalizedStringKey((review ?? package.latestReview).map { "package_decision_" + $0.decision.rawValue } ?? "package_sent"))
            ProgramPackageTimestamp(raw: package.submittedAt)
            if package.origin == .evoStarter { Text("prep_starter_title").font(.footnote) }
            if !package.isCurrentRequirements { Text("package_previous_requirements").font(.footnote).foregroundStyle(.secondary) }
        }.padding(.vertical, 4)
    }
}
