import SwiftUI

/// What the lesson shows for one exercise after the server checked it.
struct CSCACheckedEntry {
    let selected: String
    let correct: Bool
    let explain: CSCAItemExplain
}

/// Lesson and practice on the 198 write path (contract §6): the attempt is
/// started on the first «Проверить», each answer is final and its verdict
/// and explain come in the save receipt, «урок пройден» once every exercise
/// is answered. A write that failed in transit is retried with the same
/// request id and the same input; a stale revision (40001) re-reads the
/// lesson before anything else is written.
@MainActor
final class CSCALessonModel: ObservableObject {
    @Published private(set) var response: CSCALessonResponse?
    @Published private(set) var loadFailure: CSCAFailure?
    @Published private(set) var checked: [UUID: CSCACheckedEntry] = [:]
    @Published var selections: [UUID: String] = [:]
    @Published private(set) var writing: UUID?
    @Published private(set) var isCompleting = false
    @Published private(set) var writeFailure: (exercise: UUID?, failure: CSCAFailure)?
    @Published private(set) var result: CSCALessonResult?
    /// Showing a finished attempt read-only until «Пройти ещё раз».
    @Published private(set) var showsCompleted = false

    let lessonId: UUID
    private let service: SupabaseService
    private var attemptId: UUID?
    private var revision: Int64 = 0
    private var startRequestId: UUID?
    private var pendingSave: (requestId: UUID, exerciseId: UUID, answer: CSCAItemAnswer, revision: Int64)?
    private var pendingComplete: (requestId: UUID, revision: Int64)?

    init(lessonId: UUID, service: SupabaseService = .shared) {
        self.lessonId = lessonId
        self.service = service
    }

    var exercises: [CSCALessonExercise] { response?.lesson.exercises ?? [] }
    var allChecked: Bool { !exercises.isEmpty && exercises.allSatisfy { checked[$0.exerciseId] != nil } }
    var correctCount: Int { checked.values.filter(\.correct).count }

    func load() async {
        do {
            let fresh = try await service.cscaLesson(lessonId: lessonId)
            adopt(fresh)
            loadFailure = nil
        } catch is CancellationError {
        } catch {
            loadFailure = error.cscaFailure
        }
    }

    private func adopt(_ fresh: CSCALessonResponse) {
        response = fresh
        writeFailure = nil
        pendingSave = nil
        pendingComplete = nil
        if let draft = fresh.draft {
            adoptAttempt(draft)
            showsCompleted = false
            result = nil
        } else if let latest = fresh.latestCompleted {
            attemptId = nil
            revision = 0
            checked = Self.entries(latest)
            showsCompleted = true
            result = latest.result
        } else {
            attemptId = nil
            revision = 0
            checked = [:]
            showsCompleted = false
            result = nil
        }
    }

    private func adoptAttempt(_ attempt: CSCALessonAttempt) {
        attemptId = attempt.attemptId
        revision = attempt.revision
        checked = Self.entries(attempt)
    }

    private static func entries(_ attempt: CSCALessonAttempt) -> [UUID: CSCACheckedEntry] {
        attempt.records.mapValues { CSCACheckedEntry(selected: $0.answer.selected, correct: $0.correct, explain: $0.explain) }
    }

    func select(_ optionId: String, for exerciseId: UUID) {
        guard checked[exerciseId] == nil, writing == nil else { return }
        selections[exerciseId] = optionId
        if writeFailure?.exercise == exerciseId, pendingSave?.exerciseId != exerciseId { writeFailure = nil }
    }

    func check(_ exerciseId: UUID) async {
        guard writing == nil, checked[exerciseId] == nil, !showsCompleted else { return }
        writing = exerciseId
        writeFailure = nil
        defer { writing = nil }
        do {
            if attemptId == nil {
                let requestId = startRequestId ?? UUID()
                startRequestId = requestId
                let attempt = try await service.cscaStartLesson(lessonId: lessonId, requestId: requestId)
                adoptAttempt(attempt)
                if checked[exerciseId] != nil { return }
            }
            guard let attemptId else { return }
            let save: (requestId: UUID, exerciseId: UUID, answer: CSCAItemAnswer, revision: Int64)
            if let pendingSave, pendingSave.exerciseId == exerciseId {
                save = pendingSave
            } else {
                guard let selected = selections[exerciseId] else { return }
                save = (UUID(), exerciseId, CSCAItemAnswer(selected: selected), revision)
            }
            pendingSave = save
            let receipt = try await service.cscaSaveLessonAnswer(
                attemptId: attemptId, expectedRevision: save.revision, exerciseId: save.exerciseId,
                answer: save.answer, requestId: save.requestId
            )
            pendingSave = nil
            revision = receipt.revision
            checked[receipt.exerciseId] = CSCACheckedEntry(
                selected: save.answer.selected, correct: receipt.correct, explain: receipt.explain
            )
        } catch {
            await handle(error.cscaFailure, exercise: exerciseId)
        }
    }

    func complete() async {
        guard let attemptId, allChecked, !isCompleting, writing == nil else { return }
        isCompleting = true
        writeFailure = nil
        defer { isCompleting = false }
        let request = pendingComplete ?? (UUID(), revision)
        pendingComplete = request
        do {
            let attempt = try await service.cscaCompleteLesson(
                attemptId: attemptId, expectedRevision: request.revision, requestId: request.requestId
            )
            pendingComplete = nil
            checked = Self.entries(attempt)
            result = attempt.result
            self.attemptId = nil
            startRequestId = nil
        } catch {
            await handle(error.cscaFailure, exercise: nil)
        }
    }

    /// «Пройти ещё раз»: a completed attempt stays as it is; the next
    /// «Проверить» starts a new one.
    func repeatLesson() {
        guard writing == nil, !isCompleting else { return }
        showsCompleted = false
        checked = [:]
        selections = [:]
        result = nil
        attemptId = nil
        startRequestId = nil
        pendingSave = nil
        pendingComplete = nil
        writeFailure = nil
    }

    private func handle(_ failure: CSCAFailure, exercise: UUID?) async {
        switch failure {
        case .network:
            writeFailure = (exercise, failure)
        case .conflict, .alreadyAnswered:
            // The attempt changed elsewhere: re-read, then show what is saved.
            pendingSave = nil
            pendingComplete = nil
            await load()
            writeFailure = (exercise, .conflict)
        default:
            pendingSave = nil
            pendingComplete = nil
            writeFailure = (exercise, failure)
        }
    }
}

struct CSCALessonView: View {
    let lessonId: UUID

    @StateObject private var model: CSCALessonModel
    @EnvironmentObject private var home: CSCAHomeModel

    init(lessonId: UUID) {
        self.lessonId = lessonId
        _model = StateObject(wrappedValue: CSCALessonModel(lessonId: lessonId))
    }

    var body: some View {
        Group {
            if let response = model.response {
                content(response)
            } else if let failure = model.loadFailure {
                CSCAFailureView(failure: failure) { Task { await model.load() } }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color(.systemBackground))
        .navigationTitle(Text(verbatim: title))
        .navigationBarTitleDisplayMode(.inline)
        .task { if model.response == nil { await model.load() } }
    }

    private var title: String {
        guard let metadata = model.response?.lesson.metadata else { return "" }
        return CSCAText.t(metadata.kind == .lesson ? "csca_kind_lesson" : "csca_kind_practice")
    }

    private func content(_ response: CSCALessonResponse) -> some View {
        let metadata = response.lesson.metadata
        return ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: AppLocale.pick(ru: metadata.titleRu, ky: metadata.titleKy))
                        .font(.title2.weight(.bold))
                        .accessibilityAddTraits(.isHeader)
                    Text(verbatim: metadata.titleEn)
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.secondaryText)
                        .environment(\.locale, Locale(identifier: "en"))
                    Text(verbatim: CSCAText.f("csca_lesson_header_meta", metadata.syllabusPoint, metadata.estMinutes))
                        .font(.footnote)
                        .foregroundStyle(CSCAColor.secondaryText)
                }
                CSCAMathText(source: AppLocale.pick(ru: metadata.goalRu, ky: metadata.goalKy), style: .callout)

                ForEach(Array(response.lesson.theory.enumerated()), id: \.offset) { _, block in
                    if block.isRenderable {
                        CSCATheoryBlockView(block: block, figures: response.figures)
                    }
                }

                checkSection(response)
                finishSection(response)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await model.load() }
        .cscaReadingColumn()
    }

    @ViewBuilder
    private func checkSection(_ response: CSCALessonResponse) -> some View {
        let isPractice = response.lesson.metadata.kind == .practice
        VStack(alignment: .leading, spacing: 6) {
            CSCAHeading(text: CSCAText.t(isPractice ? "csca_practice_heading" : "csca_check_heading"))
            Text(verbatim: CSCAText.f("csca_check_lead", model.exercises.count))
                .font(.subheadline)
                .foregroundStyle(CSCAColor.secondaryText)
        }
        .padding(.top, isPractice ? 0 : 8)
        ForEach(Array(model.exercises.enumerated()), id: \.element.id) { index, exercise in
            CSCALessonItemCard(
                exercise: exercise,
                index: index,
                total: model.exercises.count,
                figure: exercise.item.figureKey.flatMap { response.figures[$0] },
                model: model
            )
        }
    }

    @ViewBuilder
    private func finishSection(_ response: CSCALessonResponse) -> some View {
        if let result = model.result {
            VStack(alignment: .leading, spacing: 12) {
                CSCAHeading(text: CSCAText.t("csca_lesson_done"))
                Text(verbatim: CSCAText.f("csca_correct_of", result.correctCount, result.exercisesTotal))
                    .font(.body.weight(.semibold))
                Text(csca: result.wrongExerciseIds.isEmpty ? "csca_lesson_done_clean" : "csca_lesson_done_mistakes")
                    .font(.subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
                if let practice = home.practice(after: lessonId) {
                    NavigationLink(value: CSCARoute.lesson(practice.lessonId)) {
                        Text(csca: "csca_go_practice")
                            .font(.body.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 50)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(CSCAColor.accent)
                }
                if !result.wrongExerciseIds.isEmpty {
                    NavigationLink(value: CSCARoute.review) {
                        Text(csca: "csca_review_title")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .tint(CSCAColor.accentText)
                }
                Button {
                    model.repeatLesson()
                } label: {
                    Text(csca: "csca_repeat_lesson").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderless)
                .tint(CSCAColor.accentText)
            }
            .padding(.top, 8)
        } else if model.allChecked {
            VStack(alignment: .leading, spacing: 10) {
                if let failure = model.writeFailure, failure.exercise == nil {
                    Text(csca: CSCAFailureCopy.key(failure.failure))
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.danger)
                }
                CSCAPrimaryButton(titleKey: "csca_finish_lesson", isWorking: model.isCompleting) {
                    Task { await model.complete() }
                }
            }
        }
    }
}

/// One item of the lesson check or practice.
private struct CSCALessonItemCard: View {
    let exercise: CSCALessonExercise
    let index: Int
    let total: Int
    let figure: CSCAFigure?
    @ObservedObject var model: CSCALessonModel

    var body: some View {
        let entry = model.checked[exercise.exerciseId]
        let selected = entry?.selected ?? model.selections[exercise.exerciseId]
        VStack(alignment: .leading, spacing: 14) {
            Text(verbatim: CSCAText.f("csca_item_counter", index + 1, total))
                .font(.footnote.weight(.medium))
                .foregroundStyle(CSCAColor.secondaryText)
            CSCAItemStem(item: exercise.item, figure: figure)
            CSCAOptionList(
                options: exercise.item.options,
                selected: selected,
                correctOptionId: entry?.explain.correctOptionId,
                isEnabled: entry == nil && model.writing == nil && !model.showsCompleted
            ) { id in
                model.select(id, for: exercise.exerciseId)
            }
            if let entry {
                CSCAVerdictLine(correct: entry.correct)
                CSCAExplainView(item: exercise.item, explain: entry.explain, selected: entry.selected)
            } else if !model.showsCompleted {
                if let failure = model.writeFailure, failure.exercise == exercise.exerciseId {
                    Text(csca: CSCAFailureCopy.key(failure.failure))
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.danger)
                }
                CSCAPrimaryButton(
                    titleKey: model.writeFailure?.exercise == exercise.exerciseId && model.writeFailure?.failure == .network
                        ? "csca_retry" : "csca_check_button",
                    isWorking: model.writing == exercise.exerciseId,
                    isEnabled: selected != nil && model.writing == nil
                ) {
                    Task { await model.check(exercise.exerciseId) }
                }
            }
            CSCAReportButton(itemKey: exercise.item.itemKey)
        }
        .padding(16)
        .background(CSCAColor.panel, in: RoundedRectangle(cornerRadius: 16))
    }
}
