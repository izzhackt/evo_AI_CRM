import SwiftUI
import Supabase

/// Прохождение урока по контракту миграции 198, зеркально веб-раннеру
/// (`src/components/portal/english/LessonRunner.tsx`):
/// - интро-фаза: цель и теория одним экраном, затем упражнения по одному;
/// - ответ отправляется явной кнопкой «Ответить»; вердикт и разбор рендерятся
///   ИЗ ОТВЕТА save-RPC (receipt 198:819-825) — ключей ответов на клиенте
///   нет ни в какой форме (проекция 198:519-561);
/// - неподтверждённый запрос повторяется с ТЕМ ЖЕ request_id и тем же
///   payload (правило input_hash 198:763-776); conflict (40001) — явная
///   загрузка сохранённой попытки; ответ внутри попытки финален (198:805-807);
/// - резюм черновика — с первого неотвеченного упражнения;
/// - завершение — только когда отвечено каждое упражнение (198:832-834);
///   доля верных из result_snapshot порогом НЕ является (198:830-831).
///
/// Приватность: ответы, вердикты и результаты нигде не логируются.

/// Вердикт+разбор отвеченного упражнения: из резюмированного черновика
/// (attempt payload 198:708-713) или из свежего save-receipt.
struct LearningAnsweredEntry {
    let answer: LearningAnswer
    let correct: Bool
    let verdict: LearningVerdict
    let explain: LearningExplain
}

@MainActor
final class LessonRunnerModel: ObservableObject {
    enum Phase {
        case intro
        case exercises
        case finish
        case completed
    }

    let response: LearningLessonResponse
    let exercises: [LearningExercisePublic]

    @Published private(set) var phase: Phase
    @Published private(set) var pageIndex: Int
    @Published var form: ExerciseFormValue
    @Published private(set) var answered: [UUID: LearningAnsweredEntry]
    @Published private(set) var isWriting = false
    @Published private(set) var isReloading = false
    @Published private(set) var failure: LearningWriteFailureKind?
    @Published private(set) var result: LearningLessonResult?

    private(set) var attemptId: UUID?
    private(set) var revision: Int64 = 0
    /// Стабильный на попытку запуска: повтор «Начать» после сетевой ошибки
    /// не создаёт вторую попытку (идемпотентность 198:766-776). Сбрасывается
    /// только «Пройти ещё раз».
    private var startRequestId: UUID?
    private var pendingWrite: PendingLearningWrite?
    private let service: SupabaseService

    init(response: LearningLessonResponse, service: SupabaseService = .shared) {
        self.response = response
        self.service = service
        exercises = response.lesson.exercises

        var initialAnswered: [UUID: LearningAnsweredEntry] = [:]
        if let draft = response.draft {
            attemptId = draft.attemptId
            revision = draft.revision
            initialAnswered = Self.entries(from: draft)
        }
        answered = initialAnswered
        let firstUnanswered = LearningRunnerPolicy.firstUnansweredIndex(
            exerciseIds: exercises.map(\.exerciseId),
            answered: Set(initialAnswered.keys)
        )
        let initialIndex = min(firstUnanswered, exercises.count)
        pageIndex = initialIndex
        // Черновик с ответами продолжает с упражнений; свежий (или ещё не
        // созданный) — с теории (веб: phase intro при 0 ответов).
        if response.draft != nil, !initialAnswered.isEmpty {
            phase = firstUnanswered >= exercises.count ? .finish : .exercises
        } else {
            phase = .intro
        }
        form = ExerciseFormValue(
            exercise: exercises.indices.contains(initialIndex) ? exercises[initialIndex] : nil
        )
    }

    // MARK: - Derived state

    var currentExercise: LearningExercisePublic? {
        guard phase == .exercises, exercises.indices.contains(pageIndex) else { return nil }
        return exercises[pageIndex]
    }

    var currentEntry: LearningAnsweredEntry? {
        guard let currentExercise else { return nil }
        return answered[currentExercise.exerciseId]
    }

    var answeredCount: Int { answered.count }

    var allAnswered: Bool { !exercises.isEmpty && answeredCount == exercises.count }

    var canSubmit: Bool {
        guard let currentExercise, currentEntry == nil, !isWriting else { return false }
        return form.answer(for: currentExercise) != nil
    }

    /// Заполненный, но не отправленный ответ — потеряется при выходе.
    var isDirty: Bool {
        guard let currentExercise, currentEntry == nil else { return false }
        return form.answer(for: currentExercise) != nil
    }

    /// Неподтверждённая запись: выход блокируется до подтверждения сервером.
    var hasUnconfirmedWrite: Bool { isWriting || pendingWrite != nil }

    var wrongCount: Int { result?.wrongExerciseIds.count ?? 0 }

    // MARK: - Start / resume

    func begin() async {
        failure = nil
        if attemptId != nil {
            enterExercises()
            return
        }
        guard !isWriting else { return }
        isWriting = true
        let requestId = startRequestId ?? UUID()
        startRequestId = requestId
        do {
            let payload = try await service.startLearningLesson(
                lessonId: response.lesson.lessonId,
                requestId: requestId
            )
            adopt(payload)
            enterExercises()
        } catch {
            failure = classify(error)
        }
        isWriting = false
    }

    private func enterExercises() {
        let firstUnanswered = LearningRunnerPolicy.firstUnansweredIndex(
            exerciseIds: exercises.map(\.exerciseId),
            answered: Set(answered.keys)
        )
        pageIndex = min(firstUnanswered, exercises.count)
        phase = firstUnanswered >= exercises.count ? .finish : .exercises
        resetForm()
    }

    private func adopt(_ payload: LearningAttemptSnapshot) {
        attemptId = payload.attemptId
        revision = payload.revision
        answered = Self.entries(from: payload)
        result = payload.result
        pendingWrite = nil
        failure = nil
    }

    private static func entries(from payload: LearningAttemptSnapshot) -> [UUID: LearningAnsweredEntry] {
        var entries: [UUID: LearningAnsweredEntry] = [:]
        for (key, record) in payload.answers {
            guard let exerciseId = UUID(uuidString: key) else { continue }
            entries[exerciseId] = LearningAnsweredEntry(
                answer: record.answer,
                correct: record.correct,
                verdict: record.verdict,
                explain: record.explain
            )
        }
        return entries
    }

    private func resetForm() {
        form = ExerciseFormValue(
            exercise: exercises.indices.contains(pageIndex) ? exercises[pageIndex] : nil
        )
    }

    // MARK: - Answering

    func submit() async {
        guard let exercise = currentExercise, currentEntry == nil,
              let attemptId, !isWriting else { return }
        // Замороженный неподтверждённый запрос повторяется как есть —
        // сервер вернёт исходный receipt по input_hash (198:763-776).
        let write: PendingLearningWrite
        if let pendingWrite {
            write = pendingWrite
        } else {
            guard let answer = form.answer(for: exercise) else { return }
            write = PendingLearningWrite(
                requestId: UUID(),
                operation: .save(exerciseId: exercise.exerciseId, answer: answer),
                expectedRevision: revision
            )
        }
        guard case .save(let exerciseId, let answer) = write.operation else { return }
        pendingWrite = write
        isWriting = true
        failure = nil
        do {
            let receipt = try await service.saveLearningAnswer(
                attemptId: attemptId,
                expectedRevision: write.expectedRevision ?? revision,
                exerciseId: exerciseId,
                answer: answer,
                requestId: write.requestId
            )
            revision = receipt.revision
            answered[receipt.exerciseId] = LearningAnsweredEntry(
                answer: answer,
                correct: receipt.correct,
                verdict: receipt.verdict,
                explain: receipt.explain
            )
            pendingWrite = nil
        } catch {
            let kind = classify(error)
            failure = kind
            if !PendingLearningWrite.isRetryable(after: kind) {
                pendingWrite = nil
            }
        }
        isWriting = false
    }

    func advance() {
        guard phase == .exercises else { return }
        failure = nil
        pageIndex += 1
        if pageIndex >= exercises.count {
            phase = .finish
        }
        resetForm()
    }

    // MARK: - Completion

    func complete() async {
        guard let attemptId, allAnswered, !isWriting else { return }
        let write = pendingWrite ?? PendingLearningWrite(
            requestId: UUID(),
            operation: .complete,
            expectedRevision: revision
        )
        pendingWrite = write
        isWriting = true
        failure = nil
        do {
            let payload = try await service.completeLearningLesson(
                attemptId: attemptId,
                expectedRevision: write.expectedRevision ?? revision,
                requestId: write.requestId
            )
            adopt(payload)
            phase = .completed
        } catch {
            let kind = classify(error)
            failure = kind
            if !PendingLearningWrite.isRetryable(after: kind) {
                pendingWrite = nil
            }
        }
        isWriting = false
    }

    /// Повтор незавершённого запроса после сетевой ошибки: save/complete
    /// повторяются замороженным снимком; неудавшийся start повторяется тем
    /// же стабильным startRequestId (второй попытки не будет).
    func retryPending() async {
        if let pendingWrite {
            switch pendingWrite.operation {
            case .save: await submit()
            case .complete: await complete()
            case .start: await begin()
            }
        } else if attemptId == nil {
            await begin()
        }
    }

    // MARK: - Conflict reload (40001)

    /// Явная замена локального состояния сохранённой на сервере попыткой.
    /// Вызывается только по кнопке — молча ввод не затирается.
    func reloadSavedAttempt() async {
        guard !isReloading else { return }
        isReloading = true
        do {
            let fresh = try await service.learningLesson(lessonId: response.lesson.lessonId)
            if let draft = fresh.draft {
                adopt(draft)
                enterExercises()
            } else if let completed = fresh.latestCompleted {
                // Попытку завершили в другой сессии — честно показываем итог.
                adopt(completed)
                phase = .completed
            } else {
                failure = .rejected
            }
        } catch {
            failure = classify(error)
        }
        isReloading = false
    }

    // MARK: - Repeat

    /// «Пройти ещё раз»: полный сброс локального состояния и НОВАЯ попытка
    /// (start создаёт новый draft — завершённая попытка иммутабельна).
    func repeatRun() async {
        answered = [:]
        result = nil
        attemptId = nil
        revision = 0
        startRequestId = nil
        pendingWrite = nil
        failure = nil
        pageIndex = 0
        phase = .intro
        resetForm()
        await begin()
    }

    // MARK: - Helpers

    private func classify(_ error: Error) -> LearningWriteFailureKind {
        LearningWriteFailureKind.classify(
            postgrestCode: (error as? PostgrestError)?.code,
            isTransportError: error is URLError
        )
    }
}

// MARK: - View

struct LessonRunnerView: View {
    let response: LearningLessonResponse

    @StateObject private var model: LessonRunnerModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirmReload = false
    @State private var confirmDiscard = false
    @State private var exitBlockedNotice = false

    init(response: LearningLessonResponse) {
        self.response = response
        _model = StateObject(wrappedValue: LessonRunnerModel(response: response))
    }

    var body: some View {
        NavigationStack {
            Group {
                switch model.phase {
                case .intro: introBody
                case .exercises: exercisesBody
                case .finish: finishBody
                case .completed: completedBody
                }
            }
            .navigationTitle(AppLocale.pick(
                ru: response.lesson.metadata.titleRu,
                ky: response.lesson.metadata.titleKy
            ))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { exitButton }
            }
        }
        .interactiveDismissDisabled(model.hasUnconfirmedWrite || model.isDirty)
    }

    // MARK: Exit protection

    private var exitButton: some View {
        Button("runner_close") {
            if model.hasUnconfirmedWrite {
                // Неподтверждённая запись: выход блокируется до receipt'а —
                // зеркало exit-guard'а веб-раннера.
                exitBlockedNotice = true
            } else if model.isDirty {
                confirmDiscard = true
            } else {
                dismiss()
            }
        }
        .confirmationDialog(
            "english_exit_dirty_title",
            isPresented: $confirmDiscard,
            titleVisibility: .visible
        ) {
            Button("english_exit_discard", role: .destructive) { dismiss() }
            Button("cancel_button", role: .cancel) {}
        } message: {
            Text("english_exit_dirty_message")
        }
        .alert("english_exit_blocked", isPresented: $exitBlockedNotice) {
            Button("close_button", role: .cancel) {}
        }
    }

    // MARK: Intro (цель + теория, веб-фаза intro)

    private var introBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("english_goal_heading")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(AppLocale.pick(
                        ru: response.lesson.metadata.goalRu,
                        ky: response.lesson.metadata.goalKy
                    ))
                    .font(.body)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))

                Text("english_theory_heading")
                    .font(.title3.bold())

                ForEach(Array(response.lesson.theory.enumerated()), id: \.offset) { _, block in
                    RunnerTheoryBlockView(block: block)
                }

                failureCard

                Button {
                    Task { await model.begin() }
                } label: {
                    Group {
                        if model.isWriting {
                            ProgressView()
                        } else if model.attemptId != nil {
                            Text("english_continue_lesson")
                        } else {
                            Text("english_start_lesson")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .disabled(model.isWriting || model.exercises.isEmpty)
            }
            .padding(20)
        }
    }

    // MARK: Exercises (по одному)

    private var exercisesBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                progressCard
                failureCard
                if let exercise = model.currentExercise {
                    exerciseCard(exercise)
                }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.immediately)
    }

    private var progressCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(String(
                    format: String(localized: "english_exercise_counter"),
                    model.pageIndex + 1, model.exercises.count
                ))
                .font(.subheadline.weight(.medium))
                Spacer()
                if model.isWriting {
                    Text("english_saving")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            ProgressView(
                value: Double(model.answeredCount),
                total: Double(max(model.exercises.count, 1))
            )
            .tint(Color("AccentColor"))
        }
        .padding(14)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private var failureCard: some View {
        if let failure = model.failure {
            VStack(alignment: .leading, spacing: 10) {
                Text(failureMessage(failure))
                    .font(.footnote)
                switch failure {
                case .network:
                    Button("retry_button") {
                        Task { await model.retryPending() }
                    }
                    .buttonStyle(.bordered)
                case .conflict:
                    Button("english_reload_draft") {
                        confirmReload = true
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.isReloading)
                    .confirmationDialog(
                        "english_reload_confirm",
                        isPresented: $confirmReload,
                        titleVisibility: .visible
                    ) {
                        Button("english_reload_draft", role: .destructive) {
                            Task { await model.reloadSavedAttempt() }
                        }
                    }
                case .denied, .rejected:
                    EmptyView()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func failureMessage(_ kind: LearningWriteFailureKind) -> LocalizedStringKey {
        switch kind {
        case .network: return "english_error_unavailable"
        case .conflict: return "english_error_conflict"
        case .denied: return "english_error_denied"
        case .rejected: return "english_error_invalid"
        }
    }

    private func exerciseCard(_ exercise: LearningExercisePublic) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            ExercisePromptView(exercise: exercise)

            if let entry = model.currentEntry {
                ExplainPanelView(exercise: exercise, entry: entry)
                Button(
                    model.pageIndex + 1 >= model.exercises.count
                        ? "english_to_completion" : "english_next_button"
                ) {
                    model.advance()
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .frame(maxWidth: .infinity, alignment: .trailing)
            } else {
                ExerciseFormView(
                    exercise: exercise,
                    form: $model.form,
                    disabled: model.isWriting
                )
                Button {
                    Task { await model.submit() }
                } label: {
                    Group {
                        if model.isWriting {
                            ProgressView()
                        } else {
                            Text("english_answer_button")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .disabled(!model.canSubmit)
            }
        }
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: Finish (все отвечены → завершить)

    private var finishBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                failureCard
                VStack(alignment: .leading, spacing: 12) {
                    Text("english_finish_hint")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button {
                        Task { await model.complete() }
                    } label: {
                        Group {
                            if model.isWriting {
                                ProgressView()
                            } else {
                                Text("english_finish_button")
                            }
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color("AccentColor"))
                    .disabled(!model.allAnswered || model.isWriting)
                }
                .padding(16)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
            }
            .padding(20)
        }
    }

    // MARK: Completed (итог + полный разбор)

    private var completedBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("english_completion_heading")
                        .font(.title3.bold())
                    if let result = model.result {
                        Text(String(
                            format: String(localized: "english_last_result"),
                            result.correctCount, result.exercisesTotal
                        ))
                        .font(.subheadline.weight(.medium))
                        if model.wrongCount == 0 {
                            Text("english_completion_no_mistakes")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else {
                            Text(String(
                                format: String(localized: "english_completion_mistakes"),
                                model.wrongCount
                            ))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))

                if model.wrongCount > 0 {
                    NavigationLink {
                        ReviewRunnerView(moduleId: response.module.moduleId)
                    } label: {
                        Text("english_review_entry")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color("AccentColor"))
                }

                Button {
                    Task { await model.repeatRun() }
                } label: {
                    Group {
                        if model.isWriting {
                            ProgressView()
                        } else {
                            Text("english_repeat_lesson")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(model.isWriting)

                failureCard

                // Полный разбор завершённой попытки (веб: CompletionView).
                ForEach(model.exercises) { exercise in
                    if let entry = model.answered[exercise.exerciseId] {
                        VStack(alignment: .leading, spacing: 10) {
                            ExercisePromptView(exercise: exercise)
                            ExplainPanelView(exercise: exercise, entry: entry)
                        }
                        .padding(16)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
                    }
                }
            }
            .padding(20)
        }
    }
}

// MARK: - Theory block (runner-local copy of the lesson screen block)

struct RunnerTheoryBlockView: View {
    let block: LearningTheoryBlock

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(AppLocale.pick(ru: block.textRu, ky: block.textKy))
                .font(.body)
            ForEach(Array(block.examples.enumerated()), id: \.offset) { _, example in
                VStack(alignment: .leading, spacing: 2) {
                    // Английская строка — учебное содержание, не переводится.
                    Text(example.en)
                        .font(.subheadline.weight(.semibold))
                    Text(AppLocale.pick(ru: example.ru, ky: example.ky))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Prompt

struct ExercisePromptView: View {
    let exercise: LearningExercisePublic

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if exercise.type == "matching" {
                if let instruction = LearningContentText.pick(
                    ru: exercise.instructionRu,
                    ky: exercise.instructionKy,
                    isKyrgyz: AppLocale.isKyrgyz
                ) {
                    Text(instruction)
                        .font(.body.weight(.medium))
                }
            } else if let prompt = LearningContentText.prompt(
                for: exercise,
                isKyrgyz: AppLocale.isKyrgyz
            ) {
                Text(prompt)
                    .font(.body.weight(.medium))
            }

            if exercise.type == "reading", let passage = exercise.passageEn {
                VStack(alignment: .leading, spacing: 4) {
                    Text("english_reading_passage")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    // Учебный английский текст — не переводится.
                    Text(passage)
                        .font(.subheadline)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }
}

// MARK: - Forms (общие для урока и повторения)

struct ExerciseFormView: View {
    let exercise: LearningExercisePublic
    @Binding var form: ExerciseFormValue
    let disabled: Bool

    var body: some View {
        switch exercise.type {
        case "choice":
            choiceForm
        case "matching":
            matchingForm
        case "short_answer":
            shortAnswerForm
        case "reading":
            readingForm
        default:
            // Неизвестный тип контента: честно ничего не имитируем.
            Text("english_error_invalid")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var choiceForm: some View {
        VStack(spacing: 8) {
            ForEach(exercise.options ?? []) { option in
                RunnerOptionButton(
                    label: LearningContentText.optionLabel(option, isKyrgyz: AppLocale.isKyrgyz),
                    selected: form.choiceSelection == option.id,
                    disabled: disabled
                ) {
                    form.choiceSelection = option.id
                }
            }
        }
    }

    private var matchingForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("english_matching_hint")
                .font(.footnote)
                .foregroundStyle(.secondary)
            ForEach(Array((exercise.lefts ?? []).enumerated()), id: \.offset) { leftIndex, left in
                HStack(spacing: 10) {
                    // Левая колонка — английское содержание, не переводится.
                    Text(left)
                        .font(.subheadline.weight(.semibold))
                    Spacer(minLength: 8)
                    Menu {
                        ForEach(Array((exercise.rights ?? []).enumerated()), id: \.offset) { rightIndex, right in
                            Button {
                                form.matching.assign(rightIndex: rightIndex, toLeft: leftIndex)
                            } label: {
                                let label = AppLocale.isKyrgyz ? right.rightKy : right.rightRu
                                if form.matching.assignments[leftIndex] == rightIndex {
                                    Label(label, systemImage: "checkmark")
                                } else {
                                    Text(label)
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            if let assigned = form.matching.assignments[leftIndex],
                               let right = exercise.rights?[safe: assigned] {
                                Text(AppLocale.isKyrgyz ? right.rightKy : right.rightRu)
                                    .font(.subheadline)
                            } else {
                                Text("english_matching_empty")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color(.separator), lineWidth: 1)
                        )
                    }
                    .disabled(disabled)
                }
            }
        }
    }

    private var shortAnswerForm: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("english_short_answer_label")
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField("", text: $form.shortText)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(disabled)
            Text("english_short_answer_hint")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var readingForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(exercise.questions ?? []) { question in
                VStack(alignment: .leading, spacing: 8) {
                    // Вопрос по тексту — английское содержание.
                    Text(question.promptEn)
                        .font(.subheadline.weight(.medium))
                    ForEach(question.options) { option in
                        RunnerOptionButton(
                            label: LearningContentText.optionLabel(option, isKyrgyz: AppLocale.isKyrgyz),
                            selected: form.readingSelections[question.id] == option.id,
                            disabled: disabled
                        ) {
                            form.readingSelections[question.id] = option.id
                        }
                    }
                }
            }
        }
    }
}

struct RunnerOptionButton: View {
    let label: String
    let selected: Bool
    let disabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? Color("AccentColor") : Color.secondary)
                Text(label)
                    .font(.subheadline)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(selected ? Color("AccentColor") : Color(.separator), lineWidth: selected ? 1.5 : 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

// MARK: - Explain panel (вердикт + разбор из receipt'а)

struct ExplainPanelView: View {
    let exercise: LearningExercisePublic
    let entry: LearningAnsweredEntry

    private var isKyrgyz: Bool { AppLocale.isKyrgyz }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(
                entry.correct ? "english_verdict_correct" : "english_verdict_wrong",
                systemImage: entry.correct ? "checkmark.circle.fill" : "xmark.circle.fill"
            )
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(entry.correct ? Color.green : Color("AccentColor"))

            switch exercise.type {
            case "choice": choiceExplain
            case "matching": matchingExplain
            case "short_answer": shortAnswerExplain
            case "reading": readingExplain
            default: EmptyView()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    private var choiceExplain: some View {
        let selectedId: String? = {
            if case .choice(let selected) = entry.answer { return selected }
            return nil
        }()
        if !entry.correct,
           let correctId = entry.explain.correctOptionId,
           let option = exercise.options?.first(where: { $0.id == correctId }) {
            Text(String(
                format: String(localized: "english_correct_answer"),
                LearningContentText.optionLabel(option, isKyrgyz: isKyrgyz)
            ))
            .font(.footnote.weight(.medium))
        }
        // Как на вебе: разбор только правильного и выбранного вариантов.
        ForEach(
            (entry.explain.options ?? []).filter {
                $0.id == entry.explain.correctOptionId || $0.id == selectedId
            }
        ) { option in
            Text(isKyrgyz ? option.explainKy : option.explainRu)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var matchingExplain: some View {
        // Правильные пары в исходном порядке (198:578-586); perPair того же
        // порядка помечает, где ответ был неверным.
        ForEach(Array((entry.explain.pairs ?? []).enumerated()), id: \.offset) { index, pair in
            HStack(spacing: 6) {
                if let perPair = entry.verdict.perPair, perPair[safe: index] == false {
                    Image(systemName: "xmark.circle")
                        .font(.caption)
                        .foregroundStyle(Color("AccentColor"))
                }
                Text(pair.leftEn)
                    .font(.footnote.weight(.semibold))
                Text("—")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text(isKyrgyz ? pair.rightKy : pair.rightRu)
                    .font(.footnote)
            }
        }
        if let explain = LearningContentText.pick(
            ru: entry.explain.explainRu,
            ky: entry.explain.explainKy,
            isKyrgyz: isKyrgyz
        ) {
            Text(explain)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var shortAnswerExplain: some View {
        if let answer = entry.explain.answer {
            Text(String(
                format: String(localized: "english_correct_answer"),
                answer
            ))
            .font(.footnote.weight(.medium))
        }
        if let explain = LearningContentText.pick(
            ru: entry.explain.explainRu,
            ky: entry.explain.explainKy,
            isKyrgyz: isKyrgyz
        ) {
            Text(explain)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var readingExplain: some View {
        let selected: [String: String] = {
            if case .reading(let selected) = entry.answer { return selected }
            return [:]
        }()
        ForEach(entry.explain.questions ?? []) { question in
            let questionCorrect = entry.verdict.perQuestion?[question.id] ?? false
            VStack(alignment: .leading, spacing: 4) {
                if let source = exercise.questions?.first(where: { $0.id == question.id }) {
                    Text(source.promptEn)
                        .font(.footnote.weight(.semibold))
                }
                Label(
                    questionCorrect ? "english_verdict_correct" : "english_verdict_wrong",
                    systemImage: questionCorrect ? "checkmark.circle" : "xmark.circle"
                )
                .font(.caption)
                .foregroundStyle(questionCorrect ? Color.green : Color("AccentColor"))
                if !questionCorrect,
                   let option = exercise.questions?
                       .first(where: { $0.id == question.id })?
                       .options.first(where: { $0.id == question.correctOptionId }) {
                    Text(String(
                        format: String(localized: "english_correct_answer"),
                        LearningContentText.optionLabel(option, isKyrgyz: isKyrgyz)
                    ))
                    .font(.caption)
                }
                ForEach(
                    question.options.filter {
                        $0.id == question.correctOptionId || $0.id == selected[question.id]
                    }
                ) { option in
                    Text(isKyrgyz ? option.explainKy : option.explainRu)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 2)
        }
    }
}

// MARK: - Safe index

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
