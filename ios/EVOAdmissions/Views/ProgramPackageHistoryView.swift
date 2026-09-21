import SwiftUI
import QuickLook

struct ProgramPackageHistoryView: View {
    let applicationId: UUID
    @EnvironmentObject private var session: ProgramPreparationSession
    @State private var packages: [ApplicationPackageSummary] = []
    @State private var cursor: ApplicationDocumentHistoryCursor?
    @State private var loading = false
    @State private var failed = false
    @State private var loaded = false
    @State private var visibleScope: ProgramPreparationContext.Scope?
    @State private var token = UUID()
    var body: some View {
        List {
            if visibleScope == session.context?.scope {
                ForEach(packages) { package in
                    NavigationLink { ProgramPackageDetailView(applicationId: applicationId, packageId: package.id) } label: { ProgramPackageSummaryLabel(package: package) }
                }
                if loading { ProgressView("prep_loading") }
                else if failed { Text("prep_read_failed"); Button("retry_button") { Task { await load(reset: !loaded) } }.frame(minHeight: 44) }
                else if loaded && packages.isEmpty { Text("package_history_empty") }
                else if cursor != nil { Button("program_document_more") { Task { await load(reset: false) } }.frame(minHeight: 44) }
            }
        }.navigationTitle("package_history").navigationBarTitleDisplayMode(.inline)
        .task(id: session.context?.scope) { await load(reset: true) }
    }
    private func load(reset: Bool) async {
        if reset { token = UUID(); packages = []; cursor = nil; loaded = false; visibleScope = session.context?.scope }
        else if loading { return }
        guard let context = session.context else { return }
        let request = token, generation = session.generation
        loading = true; failed = false
        defer { if request == token { loading = false } }
        do {
            let value = try await SupabaseService.shared.applicationPackageHistory(studentCaseId: context.scope.caseId, applicationId: applicationId, cursor: cursor)
            guard request == token, session.matches(context, generation: generation) else { return }
            guard Set(packages.map(\.id)).isDisjoint(with: Set(value.packages.map(\.id))), value.nextCursor == nil || value.nextCursor != cursor else { throw ApplicationPackageClientError.invalidResponse }
            packages += value.packages; cursor = value.nextCursor; loaded = true
        } catch { if request == token, session.matches(context, generation: generation) { failed = true } }
    }
}

struct ProgramPackageDetailView: View {
    let applicationId: UUID, packageId: String
    var historicalReview: ApplicationPackageReview? = nil
    @EnvironmentObject private var session: ProgramPreparationSession
    @StateObject private var documentModel = ProgramDocumentModel()
    @State private var detail: ApplicationPackageDetail?
    @State private var loading = false
    @State private var failed = false
    @State private var visibleScope: ProgramPreparationContext.Scope?
    @State private var token = UUID()
    var body: some View {
        List {
            if visibleScope == session.context?.scope {
                if let detail {
                    Section {
                        Text(detail.program.programTitle).font(.headline)
                        Text(detail.program.universityTitle)
                        Text(detail.program.intakeLabel).font(.subheadline)
                        ProgramPackageSummaryLabel(package: detail.package, review: historicalReview)
                        if historicalReview != nil { Text("package_notification_snapshot").font(.footnote).foregroundStyle(.secondary) }
                        if detail.package.origin == .evoStarter { Text("package_starter_note").font(.footnote) }
                    }
                    if let review = historicalReview ?? detail.package.latestReview {
                        Section { ProgramPackageReviewSummary(review: review, items: detail.items) } header: { Text("package_review") }
                    }
                    ForEach(detail.items) { item in
                        Section {
                            ProgramPackageDefinitionView(definition: item.definition, material: item.materialSnapshot)
                            ProgramDocumentFileLabel(file: item.submission.file)
                            if let evidence = (historicalReview ?? detail.package.latestReview)?.documentReviews.first(where: { $0.requirementItemId == item.requirementItemId }), let review = evidence.review {
                                Text(LocalizedStringKey("prep_review_\(review.decision.rawValue)"))
                                if let reason = review.reason { Text(reason) }
                                ProgramPackageTimestamp(raw: review.reviewedAt)
                                if evidence.reusedFromReview != nil { Text("package_reused_review").font(.footnote) }
                            }
                            if item.submission.file.technicalAvailability != .available { Text("package_warning_file_unavailable").font(.footnote).foregroundStyle(.secondary) }
                            if reviewChanged(item: item, detail: detail) {
                                Text("package_warning_review_changed").font(.footnote).foregroundStyle(.secondary)
                                if let current = item.submission.review {
                                    Text(LocalizedStringKey("prep_review_\(current.decision.rawValue)"))
                                    if let reason = current.reason { Text(reason) }
                                    ProgramPackageTimestamp(raw: current.reviewedAt)
                                }
                            }
                            Button("program_document_open_version") {
                                Task { await documentModel.preview(file: item.submission.file, revisionId: item.submission.requirementsRevisionId,
                                    itemId: item.requirementItemId, slotId: item.definition.documentSlotId, session: session) }
                            }.frame(minHeight: 44).disabled(documentModel.busy || item.submission.file.technicalAvailability != .available)
                        }
                    }
                    Section {
                        NavigationLink("package_review_history") { ProgramPackageReviewHistoryView(applicationId: applicationId, packageId: packageId, items: detail.items) }.frame(minHeight: 44)
                        NavigationLink("program_document_open_program") { ProgramPreparationView(applicationId: applicationId) }.frame(minHeight: 44)
                    } footer: { Text("package_help") }
                }
                if loading || documentModel.busy { ProgressView("prep_loading") }
                if failed { Text("prep_read_failed"); Button("retry_button") { Task { await load() } }.frame(minHeight: 44) }
                if let error = documentModel.errorKey { Text(LocalizedStringKey(error)).foregroundStyle(.red) }
            }
        }.navigationTitle("package_detail").navigationBarTitleDisplayMode(.inline)
        .quickLookPreview($documentModel.previewURL)
        .task(id: session.context?.scope) { await load() }
    }
    private func reviewChanged(item: ApplicationPackageItem, detail: ApplicationPackageDetail) -> Bool {
        guard let review = historicalReview ?? detail.package.latestReview else { return false }
        return review.documentReviews.first { $0.requirementItemId == item.requirementItemId }?.review?.reviewId != item.submission.review?.reviewId
    }
    private func load() async {
        token = UUID(); let request = token
        detail = nil; failed = false; documentModel.deactivate(); visibleScope = session.context?.scope
        guard let context = session.context else { return }
        let generation = session.generation; loading = true
        defer { if request == token { loading = false } }
        do {
            let value = try await SupabaseService.shared.applicationPackageDetail(studentCaseId: context.scope.caseId, applicationId: applicationId, packageId: packageId)
            guard request == token, session.matches(context, generation: generation) else { return }
            if let historicalReview {
                try ApplicationPackageWire.require(historicalReview.packageId == packageId && historicalReview.documentReviews.count == value.items.count)
                for (evidence, item) in zip(historicalReview.documentReviews, value.items) {
                    try ApplicationPackageWire.require(evidence.requirementItemId == item.requirementItemId && evidence.submissionId == item.submission.submissionId)
                }
            }
            documentModel.beginRead(context: context, applicationId: applicationId); detail = value
        } catch { if request == token, session.matches(context, generation: generation) { failed = true } }
    }
}

struct ProgramPackageDefinitionView: View {
    let definition: ApplicationDocumentDefinition, material: ApplicationDocumentMaterialSnapshot?
    var body: some View {
        ProgramPackageRequirementDetails(label: definition.label, groupLabel: definition.groupLabel,
            required: definition.required, instructions: definition.instructions, deadline: definition.deadline)
        if let material { Text(material.label + " · " + material.groupLabel).font(.footnote).foregroundStyle(.secondary) }
    }
}

struct ProgramPackageRequirementDetails: View {
    let label: String, groupLabel: String, required: Bool, instructions: String
    let deadline: ApplicationRequirementDeadline?
    @Environment(\.locale) private var locale
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.headline)
            Text(groupLabel).font(.subheadline)
            Text(LocalizedStringKey(required ? "prep_required" : "prep_optional")).font(.caption).foregroundStyle(.secondary)
            Text(instructions).font(.footnote)
            if let deadline {
                Text("prep_requirement_deadline").font(.subheadline)
                Text(deadlineLabel(deadline)).font(.footnote)
                if let source = deadline.sourceUrl, let url = URL(string: source) { Link("prep_deadline_source", destination: url).frame(minHeight: 44) }
                Text(String(localized: "prep_deadline_verified", locale: locale) + " " + (CatalogDate.dayLabel(from: deadline.verifiedOn, locale: locale) ?? deadline.verifiedOn)).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
    private func deadlineLabel(_ deadline: ApplicationRequirementDeadline) -> String {
        var result = CatalogDate.dayLabel(from: deadline.date, locale: locale) ?? deadline.date
        if let time = deadline.time { result += ", " + time }
        if let timezone = deadline.timezone { result += " (" + timezone + ")" }
        return result
    }
}
private struct ProgramPackageReviewSummary: View {
    let review: ApplicationPackageReview, items: [ApplicationPackageItem]
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(LocalizedStringKey("package_decision_\(review.decision.rawValue)")).font(.headline)
            ProgramPackageTimestamp(raw: review.reviewedAt)
            if let reason = review.reason { Text(reason) }
            ForEach(review.affectedItemIds, id: \.self) { id in
                if let item = items.first(where: { $0.requirementItemId == id }) { Text(item.definition.label).font(.subheadline) }
            }
        }
    }
}

private struct ProgramPackageReviewHistoryView: View {
    let applicationId: UUID, packageId: String, items: [ApplicationPackageItem]
    @EnvironmentObject private var session: ProgramPreparationSession
    @State private var reviews: [ApplicationPackageReview] = []
    @State private var cursor: ApplicationDocumentHistoryCursor?
    @State private var loading = false
    @State private var failed = false
    @State private var loaded = false
    @State private var visibleScope: ProgramPreparationContext.Scope?
    @State private var token = UUID()
    var body: some View {
        List {
            if visibleScope == session.context?.scope {
                ForEach(reviews, id: \.packageReviewId) { review in
                    NavigationLink { ProgramPackageDetailView(applicationId: applicationId, packageId: packageId, historicalReview: review) } label: { ProgramPackageReviewSummary(review: review, items: items) }
                }
                if loading { ProgressView("prep_loading") }
                else if failed { Text("prep_read_failed"); Button("retry_button") { Task { await load(reset: !loaded) } }.frame(minHeight: 44) }
                else if loaded && reviews.isEmpty { Text("package_review_history_empty") }
                else if cursor != nil { Button("program_document_more") { Task { await load(reset: false) } }.frame(minHeight: 44) }
            }
        }.navigationTitle("package_review_history").navigationBarTitleDisplayMode(.inline)
        .task(id: session.context?.scope) { await load(reset: true) }
    }
    private func load(reset: Bool) async {
        if reset { token = UUID(); reviews = []; cursor = nil; loaded = false; visibleScope = session.context?.scope }
        else if loading { return }
        guard let context = session.context else { return }
        let request = token, generation = session.generation; loading = true; failed = false
        defer { if request == token { loading = false } }
        do {
            let value = try await SupabaseService.shared.applicationPackageReviewHistory(studentCaseId: context.scope.caseId, applicationId: applicationId, packageId: packageId, cursor: cursor)
            guard request == token, session.matches(context, generation: generation) else { return }
            guard Set(reviews.map(\.packageReviewId)).isDisjoint(with: Set(value.reviews.map(\.packageReviewId))), value.nextCursor == nil || value.nextCursor != cursor else { throw ApplicationPackageClientError.invalidResponse }
            reviews += value.reviews; cursor = value.nextCursor; loaded = true
        } catch { if request == token, session.matches(context, generation: generation) { failed = true } }
    }
}

struct ProgramPackageNotificationView: View {
    let notificationId: UUID
    @EnvironmentObject private var session: ProgramPreparationSession
    @State private var notification: ApplicationPackageNotification?
    @State private var loading = false
    @State private var failed = false
    @State private var visibleScope: ProgramPreparationContext.Scope?
    @State private var token = UUID()
    var body: some View {
        Group {
            if visibleScope == session.context?.scope, let notification {
                ProgramPackageDetailView(applicationId: UUID(uuidString: notification.applicationId)!, packageId: notification.packageId, historicalReview: notification.review)
            } else {
                List {
                    if loading { ProgressView("prep_loading") }
                    if failed { Text("prep_read_failed"); Button("retry_button") { Task { await load() } }.frame(minHeight: 44) }
                }.navigationTitle("package_review")
            }
        }.task(id: session.context?.scope) { await load() }
    }
    private func load() async {
        token = UUID(); let request = token; notification = nil; failed = false; visibleScope = session.context?.scope
        guard let context = session.context else { return }
        let generation = session.generation; loading = true
        defer { if request == token { loading = false } }
        do {
            let value = try await SupabaseService.shared.applicationPackageNotification(notificationId: notificationId, studentCaseId: context.scope.caseId)
            guard request == token, session.matches(context, generation: generation) else { return }; notification = value
        } catch { if request == token, session.matches(context, generation: generation) { failed = true } }
    }
}
