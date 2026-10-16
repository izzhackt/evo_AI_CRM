import SwiftUI

/// Result of a finished test (contract §7.4): «оценка EVO по нашим
/// заданиям», never a CSCA score. Counts by section and topic, pace
/// against 75 s per item, then every item with its explanation.
struct CSCATestResultView: View {
    let attempt: CSCATestAttempt
    @EnvironmentObject private var home: CSCAHomeModel

    var body: some View {
        ScrollView {
            if let result = attempt.result {
                VStack(alignment: .leading, spacing: 22) {
                    summary(result)
                    breakdown(result)
                    pace(result.pace)
                    reviewList(result)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
                .frame(maxWidth: 680, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .background(Color(.systemBackground))
        .cscaReadingColumn()
        .navigationTitle(Text(verbatim: AppLocale.pick(ru: attempt.metadata.titleRu, ky: attempt.metadata.titleKy)))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func summary(_ result: CSCATestResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: CSCAText.f("csca_correct_of", result.correctCount, result.itemsTotal))
                .font(.title2.weight(.bold))
                .accessibilityAddTraits(.isHeader)
            if result.unansweredCount > 0 {
                Text(verbatim: CSCAText.f("csca_unanswered_count", result.unansweredCount))
                    .font(.body)
            }
            Text(csca: result.completion == .timeout ? "csca_completion_timeout" : "csca_completion_submitted")
                .font(.subheadline)
                .foregroundStyle(CSCAColor.secondaryText)
            Text(csca: "csca_estimate_note")
                .font(.subheadline.weight(.medium))
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(CSCAColor.panel, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func breakdown(_ result: CSCATestResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            CSCAHeading(text: CSCAText.t("csca_by_section"))
            ForEach(result.bySection.sorted { $0.section < $1.section }) { row in
                CSCACountRow(title: home.sectionTitle(row.section), correct: row.correct, answered: row.answered, total: row.total)
            }
            CSCAHeading(text: CSCAText.t("csca_by_topic"))
                .padding(.top, 6)
            ForEach(result.byTopic) { row in
                CSCACountRow(title: home.topicTitle(row.topicKey), correct: row.correct, answered: row.answered, total: row.total)
            }
        }
    }

    private func pace(_ pace: CSCAPace) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            CSCAHeading(text: CSCAText.t("csca_pace"))
            if let avg = pace.avgSeconds {
                Text(verbatim: CSCAText.f("csca_pace_line", avg, pace.budgetSeconds))
                    .font(.body)
                Text(csca: avg > pace.budgetSeconds ? "csca_pace_slow" : "csca_pace_ok")
                    .font(.subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
            } else {
                Text(csca: "csca_pace_none")
                    .font(.subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
            }
        }
    }

    private func reviewList(_ result: CSCATestResult) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            CSCAHeading(text: CSCAText.t("csca_review_items"))
            if !result.wrongItemKeys.isEmpty {
                Text(csca: "csca_wrong_to_review")
                    .font(.subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
            }
            ForEach(Array(attempt.items.enumerated()), id: \.element.id) { index, item in
                if let entry = attempt.reviewEntry(for: item.itemKey) {
                    CSCATestReviewCard(
                        item: item,
                        entry: entry,
                        index: index,
                        total: attempt.items.count,
                        figure: item.figureKey.flatMap { attempt.figures[$0] }
                    )
                }
            }
            if !result.wrongItemKeys.isEmpty {
                NavigationLink(value: CSCARoute.review) {
                    Text(csca: "csca_review_title")
                        .font(.body.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 50)
                }
                .buttonStyle(.borderedProminent)
                .tint(CSCAColor.accent)
            }
        }
    }
}

struct CSCACountRow: View {
    let title: String
    let correct: Int
    let answered: Int
    let total: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: title)
                    .font(.body)
                Spacer(minLength: 12)
                Text(verbatim: CSCAText.f("csca_correct_short", correct, total))
                    .font(.body.weight(.semibold).monospacedDigit())
            }
            ProgressView(value: Double(correct), total: Double(max(total, 1)))
                .tint(CSCAColor.ok)
                .accessibilityHidden(true)
            if answered < total {
                Text(verbatim: CSCAText.f("csca_unanswered_count", total - answered))
                    .font(.footnote)
                    .foregroundStyle(CSCAColor.secondaryText)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct CSCATestReviewCard: View {
    let item: CSCAItem
    let entry: CSCATestReviewEntry
    let index: Int
    let total: Int
    let figure: CSCAFigure?

    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(verbatim: CSCAText.f("csca_item_counter", index + 1, total))
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(CSCAColor.secondaryText)
                Spacer()
                if let seconds = entry.seconds {
                    Text(verbatim: CSCAText.f("csca_seconds_spent", seconds))
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(CSCAColor.secondaryText)
                }
            }
            CSCAVerdictLine(correct: entry.correct, answered: entry.selected != nil)
            CSCAItemStem(item: item, figure: figure)
            CSCAOptionList(options: item.options, selected: entry.selected, correctOptionId: entry.explain.correctOptionId, isEnabled: false) { _ in }
            if expanded || !entry.correct {
                CSCAExplainView(item: item, explain: entry.explain, selected: entry.selected)
            } else {
                Button {
                    withAnimation(Motion.base) { expanded = true }
                } label: {
                    Text(csca: "csca_show_explain").frame(minHeight: 44)
                }
                .tint(CSCAColor.accentText)
            }
            CSCAReportButton(itemKey: item.itemKey)
        }
        .padding(16)
        .background(CSCAColor.panel, in: RoundedRectangle(cornerRadius: 16))
    }
}

/// A past result opened from the intro or progress: one read.
struct CSCATestResultLoader: View {
    let attemptId: UUID
    @State private var attempt: CSCATestAttempt?
    @State private var failure: CSCAFailure?

    var body: some View {
        Group {
            if let attempt, attempt.isCompleted {
                CSCATestResultView(attempt: attempt)
            } else if let failure {
                CSCAFailureView(failure: failure) { Task { await load() } }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task { if attempt == nil { await load() } }
    }

    private func load() async {
        do {
            let fresh = try await SupabaseService.shared.cscaTestAttempt(attemptId: attemptId).value
            attempt = fresh
            failure = fresh.isCompleted ? nil : .invalid
        } catch is CancellationError {
        } catch {
            failure = error.cscaFailure
        }
    }
}

// MARK: - Mistakes (contract §8)

@MainActor
final class CSCAReviewModel: ObservableObject {
    @Published private(set) var response: CSCAReviewResponse?
    @Published private(set) var failure: CSCAFailure?
    @Published private(set) var position = 0
    @Published var selection: String?
    @Published private(set) var receipt: CSCAReviewReceipt?
    @Published private(set) var isChecking = false
    @Published private(set) var writeFailure: CSCAFailure?
    @Published private(set) var correctCount = 0

    private let service: SupabaseService
    private var pending: (requestId: UUID, itemKey: String, answer: CSCAItemAnswer)?

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    var current: CSCAReviewEntry? {
        guard let items = response?.items, items.indices.contains(position) else { return nil }
        return items[position]
    }

    var isFinished: Bool {
        guard let items = response?.items else { return false }
        return !items.isEmpty && position >= items.count
    }

    func load() async {
        do {
            response = try await service.cscaReview()
            position = 0
            selection = nil
            receipt = nil
            correctCount = 0
            failure = nil
        } catch is CancellationError {
        } catch {
            failure = error.cscaFailure
        }
    }

    func check() async {
        guard let entry = current, receipt == nil, !isChecking else { return }
        let request: (requestId: UUID, itemKey: String, answer: CSCAItemAnswer)
        if let pending, pending.itemKey == entry.itemKey {
            request = pending
        } else {
            guard let selection else { return }
            request = (UUID(), entry.itemKey, CSCAItemAnswer(selected: selection))
        }
        pending = request
        isChecking = true
        writeFailure = nil
        defer { isChecking = false }
        do {
            let fresh = try await service.cscaRecordReview(itemKey: request.itemKey, answer: request.answer, requestId: request.requestId)
            receipt = fresh
            selection = request.answer.selected
            if fresh.correct { correctCount += 1 }
            pending = nil
        } catch {
            let failure = error.cscaFailure
            writeFailure = failure
            if failure != .network { pending = nil }
        }
    }

    func next() {
        guard receipt != nil || writeFailure == .reviewNotDue else { return }
        position += 1
        selection = nil
        receipt = nil
        writeFailure = nil
    }
}

struct CSCAReviewView: View {
    @StateObject private var model = CSCAReviewModel()

    var body: some View {
        Group {
            if let response = model.response {
                content(response)
            } else if let failure = model.failure {
                CSCAFailureView(failure: failure) { Task { await model.load() } }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle(Text(csca: "csca_review_title"))
        .navigationBarTitleDisplayMode(.inline)
        .task { if model.response == nil { await model.load() } }
    }

    @ViewBuilder
    private func content(_ response: CSCAReviewResponse) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(csca: "csca_review_lead")
                    .font(.subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
                if response.items.isEmpty {
                    empty(response)
                } else if model.isFinished {
                    finished(response)
                } else if let entry = model.current {
                    card(entry, response: response)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await model.load() }
        .cscaReadingColumn()
    }

    private func empty(_ response: CSCAReviewResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(csca: "csca_review_empty_title").font(.headline)
            } icon: {
                Image(systemName: "checkmark.circle").foregroundStyle(CSCAColor.ok)
            }
            if let next = response.nextDueOn {
                Text(verbatim: CSCAText.f(
                    "csca_review_next_detail", CSCATime.dayLabel(next, locale: AppLocale.current), response.activeCount
                ))
                .font(.body)
            } else {
                Text(csca: "csca_review_empty_body").font(.body)
            }
        }
    }

    private func finished(_ response: CSCAReviewResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            CSCAHeading(text: CSCAText.t("csca_review_done"))
            Text(verbatim: CSCAText.f("csca_correct_of", model.correctCount, response.items.count))
                .font(.body.weight(.semibold))
            Button {
                Task { await model.load() }
            } label: {
                Text(csca: "csca_review_reload").frame(minHeight: 44)
            }
            .tint(CSCAColor.accentText)
        }
    }

    private func card(_ entry: CSCAReviewEntry, response: CSCAReviewResponse) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(verbatim: CSCAText.f("csca_item_counter", model.position + 1, response.items.count))
                    .font(.footnote.weight(.medium))
                Spacer()
                Text(verbatim: CSCAText.f("csca_box_label", entry.box))
                    .font(.footnote)
            }
            .foregroundStyle(CSCAColor.secondaryText)
            CSCAItemStem(item: entry.item, figure: entry.item.figureKey.flatMap { response.figures[$0] })
            CSCAOptionList(
                options: entry.item.options,
                selected: model.selection,
                correctOptionId: model.receipt?.explain.correctOptionId,
                isEnabled: model.receipt == nil && !model.isChecking
            ) { id in
                model.selection = id
            }
            if let receipt = model.receipt {
                CSCAVerdictLine(correct: receipt.correct)
                Text(verbatim: boxMessage(receipt))
                    .font(.subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
                CSCAExplainView(item: entry.item, explain: receipt.explain, selected: model.selection)
                CSCAPrimaryButton(titleKey: "csca_next") { model.next() }
            } else {
                if let failure = model.writeFailure {
                    Text(csca: CSCAFailureCopy.key(failure))
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.danger)
                }
                if model.writeFailure == .reviewNotDue {
                    CSCAPrimaryButton(titleKey: "csca_next") { model.next() }
                } else {
                    CSCAPrimaryButton(
                        titleKey: model.writeFailure == .network ? "csca_retry" : "csca_check_button",
                        isWorking: model.isChecking,
                        isEnabled: model.selection != nil
                    ) {
                        Task { await model.check() }
                    }
                }
            }
            CSCAReportButton(itemKey: entry.itemKey)
        }
        .padding(16)
        .background(CSCAColor.panel, in: RoundedRectangle(cornerRadius: 16))
        .id(entry.itemKey)
    }

    private func boxMessage(_ receipt: CSCAReviewReceipt) -> String {
        if receipt.retired { return CSCAText.t("csca_box_retired") }
        guard let due = receipt.dueOn else { return "" }
        let day = CSCATime.dayLabel(due, locale: AppLocale.current)
        if receipt.correct {
            return CSCAText.f("csca_box_up", day)
        }
        return CSCAText.f("csca_box_reset", day)
    }
}

// MARK: - Progress (contract §9)

struct CSCAProgressView: View {
    @EnvironmentObject private var home: CSCAHomeModel
    @State private var progress: CSCAProgress?
    @State private var failure: CSCAFailure?

    var body: some View {
        Group {
            if let progress {
                content(progress)
            } else if let failure {
                CSCAFailureView(failure: failure) { Task { await load() } }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle(Text(csca: "csca_progress_title"))
        .navigationBarTitleDisplayMode(.inline)
        .task { if progress == nil { await load() } }
    }

    private func load() async {
        do {
            progress = try await SupabaseService.shared.cscaProgress()
            failure = nil
        } catch is CancellationError {
        } catch {
            failure = error.cscaFailure
        }
    }

    private func content(_ progress: CSCAProgress) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: CSCAText.f("csca_streak_current", progress.streak.current))
                        .font(.title3.weight(.semibold))
                    Text(verbatim: CSCAText.f("csca_streak_best", progress.streak.best))
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.secondaryText)
                    Text(csca: "csca_streak_note")
                        .font(.footnote)
                        .foregroundStyle(CSCAColor.secondaryText)
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)

                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: CSCAText.f(
                        "csca_coverage", progress.coverage.topicsWithCompletedLesson, progress.coverage.topicsTotal
                    ))
                    .font(.body)
                    ProgressView(
                        value: Double(progress.coverage.topicsWithCompletedLesson),
                        total: Double(max(progress.coverage.topicsTotal, 1))
                    )
                    .tint(CSCAColor.accent)
                    .accessibilityHidden(true)
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)

                VStack(alignment: .leading, spacing: 4) {
                    if let avg = progress.pace.avgSeconds {
                        Text(verbatim: CSCAText.f("csca_pace_line", avg, progress.pace.budgetSeconds))
                    } else {
                        Text(csca: "csca_pace_none")
                    }
                }
                .font(.body)
                .padding(.vertical, 4)

                Text(verbatim: CSCAText.f(
                    "csca_review_counts", progress.review.dueCount, progress.review.activeCount, progress.review.retiredCount
                ))
                .font(.body)
                .padding(.vertical, 4)
            }

            Section {
                ForEach(CSCATopicState.allCases.reversed(), id: \.self) { state in
                    let count = progress.topics.filter { $0.state == state }.count
                    HStack {
                        CSCAStateBadge(state: state)
                        Spacer()
                        Text(verbatim: "\(count)")
                            .font(.body.weight(.semibold).monospacedDigit())
                    }
                    .frame(minHeight: 32)
                    .accessibilityElement(children: .combine)
                }
            } header: {
                Text(csca: "csca_topics_by_state")
            } footer: {
                Text(csca: "csca_state_rule")
            }

            let active = progress.topics.filter { $0.answersTotal > 0 || $0.lessonCompleted }
            if !active.isEmpty {
                Section {
                    ForEach(active) { topic in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verbatim: home.topicTitle(topic.topicKey))
                            HStack(spacing: 12) {
                                CSCAStateBadge(state: topic.state)
                                Text(verbatim: CSCAText.f("csca_topic_totals", topic.correctTotal, topic.answersTotal))
                                    .font(.footnote.monospacedDigit())
                                    .foregroundStyle(CSCAColor.secondaryText)
                            }
                        }
                        .padding(.vertical, 2)
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    Text(csca: "csca_active_topics")
                }
            }

            Section {
                if progress.tests.isEmpty {
                    Text(csca: "csca_tests_none")
                        .foregroundStyle(CSCAColor.secondaryText)
                } else {
                    ForEach(progress.tests) { test in
                        NavigationLink(value: CSCARoute.testResult(test.attemptId)) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(csca: test.kind == .mock ? "csca_mock" : "csca_diagnostic")
                                    .font(.body.weight(.semibold))
                                Text(verbatim: CSCAText.f("csca_correct_of", test.correctCount, test.itemsTotal)
                                    + ". " + CSCATime.momentLabel(test.completedAt, locale: AppLocale.current))
                                    .font(.subheadline)
                                    .foregroundStyle(CSCAColor.secondaryText)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            } header: {
                Text(csca: "csca_tests_history")
            } footer: {
                Text(csca: "csca_estimate_note")
            }
        }
        .listStyle(.insetGrouped)
        .refreshable { await load() }
    }
}
