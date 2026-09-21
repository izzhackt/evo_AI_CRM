import SwiftUI
import UniformTypeIdentifiers
import QuickLook

struct ProgramDocumentControls: View {
    let item: ApplicationDocumentItem
    let revisionId: String
    let applicationId: UUID
    @ObservedObject var model: ProgramDocumentModel
    @EnvironmentObject private var session: ProgramPreparationSession
    @Environment(\.locale) private var locale
    @State private var importing = false
    @State private var selected: ApplicationDocumentReusableVersion?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let draft = item.savedDraft, draft.file.id != item.submission?.file.id {
                VStack(alignment: .leading, spacing: 4) {
                    Text("program_document_saved").font(.subheadline.weight(.semibold))
                    fileLabel(draft.file)
                    previewButton(draft.file, revision: draft.requirementsRevisionId, item: draft.requirementItemId, slot: draft.documentSlotId)
                    if item.canSubmit && draft.file.technicalAvailability == .available && model.pendingSubmit(item.id) == nil {
                        Button("program_document_submit") {
                            Task { await model.submit(itemId: item.id, selection: .init(kind: "program_upload", documentVersionId: draft.file.id, uploadContextId: draft.uploadContextId), session: session) }
                        }.frame(minHeight: 44)
                    }
                }
            }
            if let submission = item.submission {
                VStack(alignment: .leading, spacing: 4) {
                    Text("program_document_sent").font(.subheadline.weight(.semibold))
                    fileLabel(submission.file)
                    Text(timestampLabel(submission.submittedAt)).font(.footnote).foregroundStyle(.secondary)
                    if let review = submission.review {
                        Text(LocalizedStringKey("prep_review_\(review.decision.rawValue)")).font(.subheadline)
                        if let reason = review.reason { Text(reason).font(.subheadline) }
                        Text(timestampLabel(review.reviewedAt)).font(.footnote).foregroundStyle(.secondary)
                    } else { Text("program_document_awaiting_review").font(.footnote) }
                    previewButton(submission.file, revision: submission.requirementsRevisionId, item: submission.requirementItemId, slot: submission.documentSlotId)
                }
            }
            if let previous = item.previousEvidence {
                VStack(alignment: .leading, spacing: 4) {
                    Text(LocalizedStringKey(previous.submission?.review != nil ? "program_document_previous_review" : "program_document_previous_evidence"))
                        .font(.subheadline.weight(.semibold))
                    fileLabel(previous.file)
                    if let review = previous.submission?.review {
                        Text(LocalizedStringKey("prep_review_\(review.decision.rawValue)"))
                        if let reason = review.reason { Text(reason) }
                    }
                    Text("program_document_previous_not_current").font(.footnote).foregroundStyle(.secondary)
                    previewButton(previous.file, revision: previous.requirementsRevisionId, item: previous.requirementItemId, slot: previous.definition.documentSlotId)
                }
            }
            if model.pendingUpload(item.id) != nil {
                Text("program_document_reselect_same").font(.footnote)
                Button("program_document_retry_upload") { importing = true }.frame(minHeight: 44)
            } else if item.canUpload {
                Button(LocalizedStringKey(item.submission?.review?.reason != nil ? "program_document_correct" : "program_document_choose_save")) { importing = true }
                    .frame(minHeight: 44)
                Text("program_document_save_explanation").font(.footnote).foregroundStyle(.secondary)
            }
            if model.pendingSubmit(item.id) != nil {
                Text("program_document_request_unknown").font(.footnote)
                Button("program_document_retry_submit") { Task { await model.submit(itemId: item.id, selection: nil, session: session) } }
                    .frame(minHeight: 44)
            } else if item.canSubmit {
                NavigationLink {
                    ProgramDocumentReusablePicker(applicationId: applicationId, itemId: item.id) { selected = $0 }
                } label: { Text("program_document_reuse").frame(minHeight: 44) }
                if let selected {
                    fileLabel(selected.file)
                    Button("program_document_submit_selected") {
                        Task { await model.submit(itemId: item.id, selection: selected.selection, session: session) }
                    }.frame(minHeight: 44).disabled(selected.file.technicalAvailability != .available)
                }
            }
            NavigationLink {
                ProgramDocumentHistoryView(applicationId: applicationId, itemId: item.id, model: model)
            } label: { Text("program_document_item_history").frame(minHeight: 44) }
        }
        .disabled(model.busy)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .jpeg, .png]) { result in
            if case .success(let url) = result { Task { await model.saveFile(url, itemId: item.id, session: session) } }
        }
    }
    @ViewBuilder private func fileLabel(_ file: ApplicationDocumentFileSummary) -> some View {
        ProgramDocumentFileLabel(file: file)
    }
    private func timestampLabel(_ raw: String) -> String {
        PostgresTimestamp.date(from: raw)?.formatted(.dateTime.day().month().year().hour().minute().locale(locale)) ?? raw
    }
    private func previewButton(_ file: ApplicationDocumentFileSummary, revision: String, item: String, slot: String) -> some View {
        Button("program_document_open_version") {
            Task { await model.preview(file: file, revisionId: revision, itemId: item, slotId: slot, session: session) }
        }.frame(minHeight: 44).disabled(file.technicalAvailability != .available)
    }
}

struct ProgramDocumentFileLabel: View {
    @Environment(\.locale) private var locale
    let file: ApplicationDocumentFileSummary
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(file.file.originalFilename).font(.subheadline).textSelection(.enabled)
            Text(String(localized: "program_document_version", locale: locale) + " " + file.versionNo).font(.caption).foregroundStyle(.secondary)
            ForEach(file.unavailableReasons, id: \.rawValue) { reason in
                Text(LocalizedStringKey("prep_file_\(reason.rawValue)")).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}

struct ProgramDocumentPendingSection: View {
    @ObservedObject var model: ProgramDocumentModel
    @EnvironmentObject private var session: ProgramPreparationSession
    @State private var itemId: String?
    @State private var importing = false
    var body: some View {
        if !model.oldUploads.isEmpty || !model.oldSubmits.isEmpty {
            Section {
                Text("program_document_pending_old_help").font(.footnote)
                ForEach(model.oldUploads, id: \.requestId) { pending in
                    VStack(alignment: .leading) {
                        Text(pending.intent.file.originalFilename)
                        Button("program_document_retry_upload") { itemId = pending.requirementItemId; importing = true }.frame(minHeight: 44)
                    }
                }
                ForEach(model.oldSubmits, id: \.requestId) { pending in
                    Button("program_document_retry_submit") {
                        Task { await model.submit(itemId: pending.requirementItemId, selection: nil, session: session) }
                    }.frame(minHeight: 44)
                }
            } header: { Text("program_document_pending_title") }
            .disabled(model.busy)
            .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .jpeg, .png]) { result in
                if case .success(let url) = result, let itemId { Task { await model.saveFile(url, itemId: itemId, session: session) } }
            }
        }
    }
}

struct ProgramDocumentReusablePicker: View {
    let applicationId: UUID, itemId: String
    let onSelect: (ApplicationDocumentReusableVersion) -> Void
    @EnvironmentObject private var session: ProgramPreparationSession
    @Environment(\.dismiss) private var dismiss
    @State private var versions: [ApplicationDocumentReusableVersion] = []
    @State private var cursor: ApplicationDocumentVersionCursor?
    @State private var loading = false
    @State private var failed = false
    @State private var loaded = false
    var body: some View {
        List {
            Text("program_document_reuse_help").font(.footnote)
            ForEach(versions) { version in
                Button { onSelect(version); dismiss() } label: { ProgramDocumentFileLabel(file: version.file) }
                    .disabled(version.file.technicalAvailability != .available)
            }
            if loading { ProgressView("prep_loading") }
            else if failed { Text("prep_read_failed"); Button("retry_button") { Task { await load(reset: !loaded) } } }
            else if loaded && versions.isEmpty { Text("program_document_no_reusable") }
            else if cursor != nil { Button("program_document_more") { Task { await load(reset: false) } } }
        }
        .navigationTitle("program_document_reuse")
        .task(id: session.context?.scope) { await load(reset: true) }
    }
    private func load(reset: Bool) async {
        guard !loading, let context = session.context else { return }
        let generation = session.generation
        if reset { versions = []; cursor = nil; loaded = false }
        loading = true; failed = false
        defer { loading = false }
        do {
            let page = try await SupabaseService.shared.applicationDocumentReusableVersions(studentCaseId: context.scope.caseId,
                applicationId: applicationId, requirementItemId: itemId, cursor: cursor)
            guard session.matches(context, generation: generation) else { return }
            guard Set(versions.map(\.id)).isDisjoint(with: Set(page.versions.map(\.id))), page.nextCursor == nil || page.nextCursor != cursor else { throw ApplicationDocumentClientError.invalidResponse }
            versions += page.versions; cursor = page.nextCursor; loaded = true
        } catch { if session.matches(context, generation: generation) { failed = true } }
    }
}

struct ProgramDocumentHistoryView: View {
    let applicationId: UUID
    var itemId: String? = nil
    @ObservedObject var model: ProgramDocumentModel
    @EnvironmentObject private var session: ProgramPreparationSession
    @Environment(\.locale) private var locale
    @State private var events: [ApplicationDocumentHistoryEntry] = []
    @State private var cursor: ApplicationDocumentHistoryCursor?
    @State private var loading = false
    @State private var failed = false
    @State private var loaded = false
    var body: some View {
        List {
            Text("program_document_history_help").font(.footnote)
            ForEach(events) { event in
                VStack(alignment: .leading, spacing: 8) {
                    historicalDefinition(event.definition)
                    Text(LocalizedStringKey(event.kind == "upload" ? "program_document_event_saved" : "program_document_sent")).font(.subheadline)
                    Text(PostgresTimestamp.date(from: event.createdAt)?.formatted(.dateTime.day().month().year().hour().minute().locale(locale)) ?? event.createdAt)
                        .font(.footnote).foregroundStyle(.secondary)
                    ProgramDocumentFileLabel(file: event.file)
                    if let review = event.submission?.review {
                        Text(LocalizedStringKey("prep_review_\(review.decision.rawValue)"))
                        if let reason = review.reason { Text(reason) }
                    }
                    Button("program_document_open_version") {
                        Task { await model.preview(file: event.file, revisionId: event.requirementsRevisionId,
                            itemId: event.requirementItemId, slotId: event.definition.documentSlotId, session: session) }
                    }.frame(minHeight: 44).disabled(model.busy || event.file.technicalAvailability != .available)
                }.padding(.vertical, 4)
            }
            if let error = model.errorKey { Text(LocalizedStringKey(error)).foregroundStyle(.red) }
            if loading { ProgressView("prep_loading") }
            else if failed { Text("prep_read_failed"); Button("retry_button") { Task { await load(reset: !loaded) } } }
            else if loaded && events.isEmpty { Text("program_document_history_empty") }
            else if cursor != nil { Button("program_document_more") { Task { await load(reset: false) } } }
        }
        .navigationTitle("program_document_history")
        .quickLookPreview($model.previewURL)
        .task(id: session.context?.scope) { await load(reset: true) }
    }
    @ViewBuilder
    private func historicalDefinition(_ definition: ApplicationDocumentDefinition) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(definition.label).font(.headline).accessibilityAddTraits(.isHeader)
            Text(definition.groupLabel).font(.subheadline)
            Text(LocalizedStringKey(definition.required ? "prep_required" : "prep_optional"))
                .font(.caption).foregroundStyle(.secondary)
            Text(definition.instructions).font(.footnote)
            if let deadline = definition.deadline {
                Text("prep_requirement_deadline").font(.subheadline)
                Text(deadlineLabel(deadline)).font(.footnote)
                if let source = deadline.sourceUrl, let url = URL(string: source) {
                    Link("prep_deadline_source", destination: url)
                        .font(.footnote).frame(minHeight: 44, alignment: .leading)
                }
                Text(String(localized: "prep_deadline_verified", locale: locale) + " "
                     + (CatalogDate.dayLabel(from: deadline.verifiedOn, locale: locale) ?? deadline.verifiedOn))
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func deadlineLabel(_ deadline: ApplicationRequirementDeadline) -> String {
        let day = CatalogDate.dayLabel(from: deadline.date, locale: locale) ?? deadline.date
        let time = deadline.time.map { ", \($0)" } ?? ""
        let timezone = deadline.timezone.map { " (\($0))" } ?? ""
        return day + time + timezone
    }

    private func load(reset: Bool) async {
        guard !loading, let context = session.context else { return }
        let generation = session.generation
        if reset { events = []; cursor = nil; loaded = false }
        loading = true; failed = false
        defer { loading = false }
        do {
            let page = try await SupabaseService.shared.applicationDocumentHistory(studentCaseId: context.scope.caseId,
                applicationId: applicationId, requirementItemId: itemId, cursor: cursor)
            guard session.matches(context, generation: generation) else { return }
            guard Set(events.map(\.id)).isDisjoint(with: Set(page.events.map(\.id))), page.nextCursor == nil || page.nextCursor != cursor else { throw ApplicationDocumentClientError.invalidResponse }
            events += page.events; cursor = page.nextCursor; loaded = true
        } catch { if session.matches(context, generation: generation) { failed = true } }
    }
}

/// The review referenced by this notification remains historical even when a
/// newer submission/review exists. Opening it never submits or marks anything read.
struct ProgramDocumentNotificationView: View {
    let notificationId: UUID
    @EnvironmentObject private var session: ProgramPreparationSession
    @Environment(\.locale) private var locale
    @StateObject private var model = ProgramDocumentModel()
    @State private var notification: ApplicationDocumentNotification?
    @State private var loading = false
    @State private var failed = false
    var body: some View {
        List {
            if let notification, let review = notification.submission.review {
                Section {
                    ProgramDocumentFileLabel(file: notification.submission.file)
                    Text(LocalizedStringKey("prep_review_\(review.decision.rawValue)")).font(.headline)
                    if let reason = review.reason { Text(reason) }
                    Text(PostgresTimestamp.date(from: review.reviewedAt)?.formatted(.dateTime.day().month().year().hour().minute().locale(locale)) ?? review.reviewedAt)
                        .font(.footnote).foregroundStyle(.secondary)
                    Text("program_document_notification_snapshot").font(.footnote).foregroundStyle(.secondary)
                    Button("program_document_open_version") {
                        Task { await model.preview(file: notification.submission.file, revisionId: notification.requirementsRevisionId,
                            itemId: notification.requirementItemId, slotId: notification.documentSlotId, session: session) }
                    }.frame(minHeight: 44).disabled(model.busy || notification.submission.file.technicalAvailability != .available)
                    NavigationLink { ProgramPreparationView(applicationId: UUID(uuidString: notification.applicationId)!) } label: {
                        Text("program_document_open_program").frame(minHeight: 44)
                    }
                }
            }
            if loading { ProgressView("prep_loading") }
            if failed { Text("prep_read_failed"); Button("retry_button") { Task { await load() } } }
            if let error = model.errorKey { Text(LocalizedStringKey(error)).foregroundStyle(.red) }
        }
        .navigationTitle("program_document_review_detail")
        .quickLookPreview($model.previewURL)
        .task(id: session.context?.scope) { await load() }
    }
    private func load() async {
        notification = nil
        guard let context = session.context else { model.deactivate(); return }
        let generation = session.generation
        loading = true; failed = false
        defer { loading = false }
        do {
            let value = try await SupabaseService.shared.studentApplicationDocumentNotification(notificationId: notificationId, studentCaseId: context.scope.caseId)
            guard session.matches(context, generation: generation) else { return }
            model.beginRead(context: context, applicationId: UUID(uuidString: value.applicationId)!)
            notification = value
        } catch { if session.matches(context, generation: generation) { failed = true } }
    }
}
