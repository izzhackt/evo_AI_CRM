import SwiftUI

/// Pushed CSCA screens. A dedicated route type: the English tab already
/// routes plain UUID values to its own lessons.
enum CSCARoute: Hashable {
    case home
    case topic(String)
    case lesson(UUID)
    case test(CSCATestKind)
    case testResult(UUID)
    case review
    case progress
    case sessions
    case licenses
}

/// One read of `learning_track_home_v1` per visit; the screens pushed from
/// here take titles and lesson lists from this model instead of reading
/// again.
@MainActor
final class CSCAHomeModel: ObservableObject {
    /// One model for the CSCA screens of the English stack. Every entry
    /// through `CSCAHomeView` resets it first, so a new sign-in never sees
    /// the previous account's data.
    static let shared = CSCAHomeModel()

    @Published private(set) var home: CSCAHome?
    @Published private(set) var failure: CSCAFailure?
    @Published private(set) var isLoading = false
    @Published private(set) var isSavingTarget = false
    @Published var targetFailure: CSCAFailure?

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func reset() {
        home = nil
        failure = nil
        targetFailure = nil
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            home = try await service.cscaHome().value
            failure = nil
        } catch is CancellationError {
        } catch {
            failure = error.cscaFailure
        }
    }

    func setTarget(_ sessionKey: String?) async {
        guard !isSavingTarget else { return }
        isSavingTarget = true
        targetFailure = nil
        defer { isSavingTarget = false }
        do {
            _ = try await service.cscaSetTargetSession(sessionKey: sessionKey)
            await load()
        } catch {
            targetFailure = error.cscaFailure
        }
    }

    // MARK: Lookups for child screens

    var module: CSCAModule? { home?.modules.first }

    func topicTitle(_ key: String) -> String {
        guard let topic = home?.topic(forKey: key) else { return key }
        return AppLocale.pick(ru: topic.metadata.titleRu, ky: topic.metadata.titleKy)
    }

    func sectionTitle(_ number: Int) -> String {
        guard let section = module?.metadata.sections.first(where: { $0.section == number }) else {
            return String(number)
        }
        return AppLocale.pick(ru: section.titleRu, ky: section.titleKy)
    }

    /// The practice that follows a lesson of the same topic.
    func practice(after lessonId: UUID) -> CSCALessonSummary? {
        guard let home, let lesson = home.lesson(id: lessonId), lesson.metadata.kind == .lesson else { return nil }
        return home.lessons(forTopic: lesson.metadata.topicKey).first { $0.metadata.kind == .practice }
    }
}

/// Entry row in the English tab (owner default: the tab keeps its name).
struct CSCAEntryRow: View {
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "function")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(CSCAColor.accentFill, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(csca: "csca_entry_title")
                    .font(.headline)
                Text(csca: "csca_entry_subtitle")
                    .font(.subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Destination of every CSCA route, declared once at the root of the
/// English stack (`EnglishView`).
struct CSCARouteView: View {
    let route: CSCARoute

    var body: some View {
        destination.environmentObject(CSCAHomeModel.shared)
    }

    @ViewBuilder
    private var destination: some View {
        switch route {
        case .home: CSCAHomeView()
        case .topic(let key): CSCATopicView(topicKey: key)
        case .lesson(let id): CSCALessonView(lessonId: id)
        case .test(let kind): CSCATestIntroView(kind: kind)
        case .testResult(let id): CSCATestResultLoader(attemptId: id)
        case .review: CSCAReviewView()
        case .progress: CSCAProgressView()
        case .sessions: CSCASessionsView()
        case .licenses: LicensesView()
        }
    }
}

struct CSCAHomeView: View {
    @EnvironmentObject private var model: CSCAHomeModel
    @State private var loadedOnce = false

    var body: some View {
        content
            .navigationTitle(Text(csca: "csca_title"))
            .navigationBarTitleDisplayMode(.large)
            .onAppear {
                // Returning from a lesson or test: one fresh read.
                if loadedOnce { Task { await model.load() } }
            }
            .task {
                if !loadedOnce {
                    loadedOnce = true
                    model.reset()
                    await model.load()
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        if let home = model.home {
            CSCAHomeList(home: home)
                .refreshable { await model.load() }
        } else if let failure = model.failure {
            CSCAFailureView(failure: failure) { Task { await model.load() } }
        } else {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct CSCAHomeList: View {
    let home: CSCAHome
    @EnvironmentObject private var model: CSCAHomeModel

    var body: some View {
        List {
            if let module = home.modules.first {
                Section {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(verbatim: AppLocale.pick(ru: module.metadata.titleRu, ky: module.metadata.titleKy))
                            .font(.title3.weight(.semibold))
                            .accessibilityAddTraits(.isHeader)
                        Text(verbatim: AppLocale.pick(ru: module.metadata.levelNoteRu, ky: module.metadata.levelNoteKy))
                            .font(.subheadline)
                            .foregroundStyle(CSCAColor.secondaryText)
                    }
                    .padding(.vertical, 4)
                }
            }

            if let step = home.nextStep {
                Section {
                    CSCANextStepRow(step: step, home: home)
                } header: {
                    Text(csca: "csca_next_step")
                }
            }

            Section {
                ForEach(home.tests) { test in
                    NavigationLink(value: CSCARoute.test(test.kind)) {
                        CSCATestRow(test: test, serverNow: home.serverNow)
                    }
                }
                NavigationLink(value: CSCARoute.review) {
                    CSCAReviewRow(review: home.review, locale: AppLocale.current)
                }
                NavigationLink(value: CSCARoute.progress) {
                    Label {
                        Text(csca: "csca_progress_title")
                    } icon: {
                        Image(systemName: "chart.bar.xaxis").foregroundStyle(CSCAColor.accent)
                    }
                    .frame(minHeight: 44)
                }
            } header: {
                Text(csca: "csca_practice_header")
            }

            ForEach(home.modules.first?.metadata.sections ?? []) { section in
                let topics = home.topics
                    .filter { $0.metadata.section == section.section }
                    .sorted { $0.orderIndex < $1.orderIndex }
                if !topics.isEmpty {
                    Section {
                        ForEach(topics) { topic in
                            CSCATopicRow(topic: topic)
                        }
                    } header: {
                        Text(verbatim: AppLocale.pick(ru: section.titleRu, ky: section.titleKy))
                    } footer: {
                        Text(verbatim: CSCAText.f("csca_section_weight", section.mockItemsEstimate))
                    }
                }
            }

            Section {
                NavigationLink(value: CSCARoute.sessions) {
                    CSCATargetRow(home: home)
                }
            } header: {
                Text(csca: "csca_sessions_header")
            }

            Section {
                EmptyView()
            } footer: {
                VStack(alignment: .leading, spacing: 8) {
                    Text(csca: "csca_disclaimer")
                    if let module = home.modules.first, let url = URL(string: module.metadata.syllabusUrl) {
                        Link(destination: url) {
                            Text(verbatim: CSCAText.f("csca_syllabus_link", module.metadata.syllabusEdition))
                                .underline()
                        }
                        .font(.footnote)
                        .tint(.primary)
                    }
                    // Тот же экран «Лицензии», что в «Профиле» (review #1215, M3).
                    NavigationLink(value: CSCARoute.licenses) {
                        Text("licenses_title").underline()
                    }
                    .font(.footnote)
                    .tint(.primary)
                }
                .padding(.top, 4)
            }
        }
        .listStyle(.insetGrouped)
    }
}

private struct CSCANextStepRow: View {
    let step: CSCANextStep
    let home: CSCAHome
    @EnvironmentObject private var model: CSCAHomeModel

    var body: some View {
        NavigationLink(value: route) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: symbol)
                    .font(.title2)
                    .foregroundStyle(CSCAColor.accent)
                    .frame(width: 32)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: title)
                        .font(.headline)
                    Text(verbatim: detail)
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.secondaryText)
                }
            }
            .padding(.vertical, 6)
        }
        .accessibilityElement(children: .combine)
    }

    private var route: CSCARoute {
        switch step {
        case .test: return .test(.diagnostic)
        case .lesson(let lessonId, _, _, _, _): return .lesson(lessonId)
        case .review: return .review
        }
    }

    private var symbol: String {
        switch step {
        case .test: return "stopwatch"
        case .lesson(_, _, let kind, _, _): return kind == .lesson ? "book" : "pencil.and.list.clipboard"
        case .review: return "arrow.counterclockwise"
        }
    }

    private var title: String {
        switch step {
        case .test(let formId, _):
            let test = home.tests.first { $0.formId == formId }
            return test.map { AppLocale.pick(ru: $0.metadata.titleRu, ky: $0.metadata.titleKy) } ?? CSCAText.t("csca_diagnostic")
        case .lesson(let lessonId, _, _, _, _):
            let lesson = home.lesson(id: lessonId)
            return lesson.map { AppLocale.pick(ru: $0.metadata.titleRu, ky: $0.metadata.titleKy) } ?? ""
        case .review:
            return CSCAText.t("csca_review_title")
        }
    }

    private var detail: String {
        switch step {
        case .test(let formId, _):
            let test = home.tests.first { $0.formId == formId }
            return test.map { AppLocale.pick(ru: $0.metadata.introRu, ky: $0.metadata.introKy) } ?? ""
        case .lesson(_, _, let kind, _, let state):
            let kindWord = CSCAText.t(kind == .lesson ? "csca_kind_lesson" : "csca_kind_practice")
            return CSCAText.f("csca_next_lesson_detail", kindWord, CSCAText.t(CSCAStateBadge.labelKey(state)))
        case .review:
            return CSCAText.f("csca_review_due_count", home.review.dueCount)
        }
    }
}

struct CSCATestRow: View {
    let test: CSCATestSummary
    let serverNow: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: test.kind == .mock ? "timer" : "stopwatch")
                    .foregroundStyle(CSCAColor.accent)
                    .accessibilityHidden(true)
                Text(verbatim: AppLocale.pick(ru: test.metadata.titleRu, ky: test.metadata.titleKy))
                    .font(.body.weight(.semibold))
            }
            Text(verbatim: CSCAText.testMeta(itemsTotal: test.itemsTotal, durationSeconds: test.durationSeconds))
            .font(.subheadline)
            .foregroundStyle(CSCAColor.secondaryText)
            if test.draft != nil {
                Text(csca: "csca_test_draft_open")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(CSCAColor.accentText)
            } else if let last = test.lastResult {
                Text(verbatim: CSCAText.f("csca_test_last_result", last.correctCount, last.itemsTotal))
                    .font(.subheadline)
                    .foregroundStyle(.primary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct CSCAReviewRow: View {
    let review: CSCAReviewSummary
    let locale: Locale

    var body: some View {
        HStack {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(csca: "csca_review_title")
                    Text(verbatim: subtitle)
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.secondaryText)
                }
            } icon: {
                Image(systemName: "arrow.counterclockwise").foregroundStyle(CSCAColor.accent)
            }
            Spacer()
            if review.dueCount > 0 {
                Text(verbatim: "\(review.dueCount)")
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(CSCAColor.accentFill, in: Capsule())
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        if review.dueCount > 0 { return CSCAText.f("csca_review_due_count", review.dueCount) }
        if let next = review.nextDueOn {
            return CSCAText.f("csca_review_next_on", CSCATime.dayLabel(next, locale: locale))
        }
        return CSCAText.t("csca_review_empty_short")
    }
}

private struct CSCATopicRow: View {
    let topic: CSCATopic

    var body: some View {
        if topic.hasLessons {
            NavigationLink(value: CSCARoute.topic(topic.topicKey)) { label }
        } else {
            label
                .accessibilityHint(Text(csca: "csca_topic_soon"))
        }
    }

    private var label: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: AppLocale.pick(ru: topic.metadata.titleRu, ky: topic.metadata.titleKy))
                .font(.body)
                .foregroundStyle(topic.hasLessons ? Color.primary : CSCAColor.secondaryText)
            HStack(spacing: 10) {
                Text(verbatim: topic.metadata.syllabusPoint)
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(CSCAColor.secondaryText)
                if topic.hasLessons {
                    CSCAStateBadge(state: topic.state)
                } else {
                    Text(csca: "csca_topic_soon")
                        .font(.footnote)
                        .foregroundStyle(CSCAColor.secondaryText)
                }
            }
        }
        .padding(.vertical, 2)
        .frame(minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

private struct CSCATargetRow: View {
    let home: CSCAHome

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let key = home.targetSessionKey, let session = home.sessions.first(where: { $0.sessionKey == key }) {
                Text(verbatim: CSCASessionCopy.dates(session))
                    .font(.body.weight(.semibold))
                if let plan = CSCASessionPlan.stage(for: session, today: home.today) {
                    Text(verbatim: CSCASessionCopy.countdown(plan.days, plan.stage))
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.secondaryText)
                }
            } else {
                Text(csca: "csca_target_choose")
                    .font(.body.weight(.semibold))
                Text(verbatim: CSCAText.f("csca_sessions_count", home.sessions.count))
                    .font(.subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

enum CSCASessionCopy {
    static func dates(_ session: CSCASession) -> String {
        let locale = AppLocale.current
        if session.examFrom == session.examTo {
            return CSCATime.dayWithYearLabel(session.examFrom, locale: locale)
        }
        return CSCAText.f(
            "csca_session_dates",
            CSCATime.dayLabel(session.examFrom, locale: locale),
            CSCATime.dayWithYearLabel(session.examTo, locale: locale)
        )
    }

    static func countdown(_ days: Int, _ stage: CSCASessionPlan.Stage) -> String {
        switch stage {
        case .past: return CSCAText.t("csca_stage_past")
        case .examDays: return CSCAText.t("csca_stage_exam_days")
        case .sprint: return CSCAText.f("csca_countdown_sprint", days)
        case .intensification: return CSCAText.f("csca_countdown_intensification", days)
        case .foundation: return CSCAText.f("csca_countdown_foundation", days)
        }
    }
}

/// Topic: its lessons and practice, state and weight in the mock.
struct CSCATopicView: View {
    let topicKey: String
    @EnvironmentObject private var model: CSCAHomeModel

    var body: some View {
        if let home = model.home, let topic = home.topic(forKey: topicKey) {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(verbatim: topic.metadata.titleEn)
                            .font(.subheadline)
                            .foregroundStyle(CSCAColor.secondaryText)
                            .environment(\.locale, Locale(identifier: "en"))
                            .accessibilityLabel(Text(CSCASpeech.english(topic.metadata.titleEn)))
                        CSCAStateBadge(state: topic.state)
                        Text(verbatim: stateDetail(topic))
                            .font(.subheadline)
                            .foregroundStyle(CSCAColor.secondaryText)
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    ForEach(home.lessons(forTopic: topicKey)) { lesson in
                        NavigationLink(value: CSCARoute.lesson(lesson.lessonId)) {
                            CSCALessonRow(lesson: lesson)
                        }
                    }
                } footer: {
                    Text(verbatim: CSCAText.f(
                        "csca_topic_meta", topic.metadata.syllabusPoint, topic.metadata.mockItemsEstimate
                    ))
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle(Text(verbatim: AppLocale.pick(ru: topic.metadata.titleRu, ky: topic.metadata.titleKy)))
            .navigationBarTitleDisplayMode(.inline)
        } else {
            CSCAFailureView(failure: .invalid, retry: nil)
        }
    }

    private func stateDetail(_ topic: CSCATopic) -> String {
        if topic.windowAnswers == 0 { return CSCAText.t("csca_topic_no_answers") }
        return CSCAText.f("csca_topic_window", topic.windowCorrect, topic.windowAnswers)
    }
}

struct CSCALessonRow: View {
    let lesson: CSCALessonSummary

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: lesson.completed ? "checkmark.circle.fill" : (lesson.metadata.kind == .lesson ? "book" : "pencil.and.list.clipboard"))
                .foregroundStyle(lesson.completed ? CSCAColor.ok : CSCAColor.accent)
                .font(.title3)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: CSCAText.t(lesson.metadata.kind == .lesson ? "csca_kind_lesson" : "csca_kind_practice"))
                    .font(.body.weight(.semibold))
                Text(verbatim: subtitle)
                    .font(.subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        var parts = [CSCAText.f("csca_lesson_meta", lesson.exercisesTotal, lesson.metadata.estMinutes)]
        if lesson.draftAttemptId != nil {
            parts.append(CSCAText.t("csca_lesson_in_progress"))
        } else if let result = lesson.lastResult {
            parts.append(CSCAText.f("csca_correct_of", result.correctCount, result.exercisesTotal))
        }
        return parts.joined(separator: ". ")
    }
}

/// Official session calendar with the target the student picked.
struct CSCASessionsView: View {
    @EnvironmentObject private var model: CSCAHomeModel

    var body: some View {
        List {
            if let home = model.home {
                if let failure = model.targetFailure {
                    Section {
                        Text(csca: CSCAFailureCopy.key(failure))
                            .font(.subheadline)
                            .foregroundStyle(CSCAColor.danger)
                    }
                }
                Section {
                    ForEach(home.sessions) { session in
                        Button {
                            Task {
                                await model.setTarget(home.targetSessionKey == session.sessionKey ? nil : session.sessionKey)
                            }
                        } label: {
                            CSCASessionRow(session: session, today: home.today, isTarget: home.targetSessionKey == session.sessionKey)
                        }
                        .buttonStyle(.plain)
                        .disabled(model.isSavingTarget)
                        .accessibilityAddTraits(home.targetSessionKey == session.sessionKey ? .isSelected : [])
                        .accessibilityHint(Text(csca: home.targetSessionKey == session.sessionKey ? "csca_target_clear_hint" : "csca_target_set_hint"))
                    }
                } header: {
                    Text(csca: "csca_sessions_pick")
                } footer: {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(csca: "csca_sessions_note")
                        if let first = home.sessions.first, let url = URL(string: first.sourceUrl) {
                            Link(destination: url) {
                                Text(verbatim: CSCAText.f(
                                    "csca_sessions_source", CSCATime.dayWithYearLabel(first.verifiedOn, locale: AppLocale.current)
                                ))
                                .underline()
                            }
                            .tint(.primary)
                        }
                    }
                }
                Section {
                    CSCAStageRow(key: "csca_stage_foundation_title", detail: "csca_stage_foundation_detail")
                    CSCAStageRow(key: "csca_stage_intensification_title", detail: "csca_stage_intensification_detail")
                    CSCAStageRow(key: "csca_stage_sprint_title", detail: "csca_stage_sprint_detail")
                } header: {
                    Text(csca: "csca_stages_header")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text(csca: "csca_sessions_header"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct CSCASessionRow: View {
    let session: CSCASession
    let today: String
    let isTarget: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: isTarget ? "checkmark.circle.fill" : "circle")
                .font(.title3)
                .foregroundStyle(isTarget ? CSCAColor.accent : CSCAColor.secondaryText)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: CSCASessionCopy.dates(session))
                    .font(.body.weight(.semibold))
                Text(verbatim: registration)
                    .font(.subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
                if isTarget, let plan = CSCASessionPlan.stage(for: session, today: today) {
                    Text(verbatim: CSCASessionCopy.countdown(plan.days, plan.stage))
                        .font(.subheadline.weight(.medium))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var registration: String {
        let locale = AppLocale.current
        guard let opens = session.registrationOpensAt, let closes = session.registrationClosesAt else {
            return CSCAText.t("csca_registration_unknown")
        }
        return CSCAText.f(
            "csca_registration_window", CSCATime.momentLabel(opens, locale: locale), CSCATime.momentLabel(closes, locale: locale)
        )
    }
}

private struct CSCAStageRow: View {
    let key: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(csca: key).font(.body.weight(.semibold))
            Text(csca: detail)
                .font(.subheadline)
                .foregroundStyle(CSCAColor.secondaryText)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
