import SwiftUI
import Supabase

/// Прохождение теста по контракту миграции 135, зеркально веб-раннеру
/// (`src/components/v3/portal/assessments/AssessmentRunner.tsx`):
/// - один вопрос на экран;
/// - автосейв с дебаунсом и optimistic-lock ревизией;
/// - неподтверждённый запрос повторяется с ТЕМ ЖЕ `request_id` и тем же
///   снимком ответов (идемпотентность RPC);
/// - конфликт ревизии (40001) — явная загрузка сохранённой попытки;
/// - выход только через «Сохранить и выйти» (fullScreenCover не смахивается).
///
/// Приватность: ответы и результат нигде не логируются.
@MainActor
final class AssessmentRunnerModel: ObservableObject {
    enum WriteFailureKind {
        case network      // транспорт: повтор того же запроса безопасен
        case conflict     // 40001: попытка изменилась (другое устройство)
        case denied       // 42501: доступ к тесту закрыт
        case rejected     // 22023 и прочие: запрос не принят
    }

    struct WriteFailure: Identifiable {
        let id = UUID()
        let kind: WriteFailureKind
    }

    private struct PendingWrite {
        let requestId: UUID
        let expectedRevision: Int64
        let answers: [String: String]
        let complete: Bool
    }

    @Published private(set) var attempt: AssessmentAttempt?
    @Published var answers: [String: String] = [:]
    @Published private(set) var savedFingerprint = ""
    @Published private(set) var isWriting = false
    @Published private(set) var isStarting = false
    @Published private(set) var isReloading = false
    @Published private(set) var reloadRequired = false
    @Published var failure: WriteFailure?
    @Published var pageIndex = 0
    @Published private(set) var completing = false
    @Published var loadFailedMessage: String?

    private let service: SupabaseService
    private var pendingWrite: PendingWrite?
    /// Стабильный на весь показ раннера: повторное нажатие «Начать» после
    /// сетевой ошибки не создаёт вторую попытку.
    private let startRequestId = UUID()
    private var autosaveTask: Task<Void, Never>?

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    deinit {
        autosaveTask?.cancel()
    }

    var isDirty: Bool {
        guard let attempt, attempt.isDraft else { return false }
        return fingerprint(answers) != savedFingerprint
    }

    var hasUnconfirmedWork: Bool {
        guard let attempt else { return false }
        return attempt.isDraft && (isDirty || pendingWrite != nil || isWriting)
    }

    var answeredCount: Int {
        guard let attempt else { return 0 }
        return attempt.questions.filter { answers[$0.id] != nil }.count
    }

    var questionCount: Int { attempt?.questions.count ?? 0 }

    var firstUnansweredIndex: Int {
        guard let attempt else { return 0 }
        return attempt.questions.firstIndex(where: { answers[$0.id] == nil }) ?? 0
    }

    // MARK: - Loading / starting

    func loadDraft(attemptId: UUID) async {
        loadFailedMessage = nil
        do {
            let loaded = try await service.studentAssessmentAttempt(id: attemptId)
            adopt(loaded)
        } catch {
            loadFailedMessage = error.localizedDescription
        }
    }

    func start(instrumentKey: String) async {
        if isStarting { return }
        isStarting = true
        loadFailedMessage = nil
        do {
            let started = try await service.startAssessment(
                instrumentKey: instrumentKey,
                requestId: startRequestId
            )
            adopt(started)
        } catch {
            loadFailedMessage = error.localizedDescription
        }
        isStarting = false
    }

    /// Явная замена локального состояния сохранённой на сервере попыткой
    /// (после конфликта ревизий). Вызывается только после подтверждения
    /// пользователем — молча ввод не затирается.
    func reloadSavedAttempt() async {
        guard let attempt, !isReloading, !isWriting else { return }
        autosaveTask?.cancel()
        reloadRequired = true
        isReloading = true
        do {
            let fresh = try await service.studentAssessmentAttempt(id: attempt.attemptId)
            adopt(fresh)
        } catch {
            failure = WriteFailure(kind: classify(error))
        }
        isReloading = false
    }

    private func adopt(_ fresh: AssessmentAttempt) {
        attempt = fresh
        answers = fresh.answers
        savedFingerprint = fingerprint(fresh.answers)
        pendingWrite = nil
        failure = nil
        reloadRequired = false
        completing = false
        pageIndex = min(
            fresh.questions.firstIndex(where: { fresh.answers[$0.id] == nil }) ?? fresh.questions.count,
            max(fresh.questions.count - 1, 0)
        )
    }

    // MARK: - Answering

    func select(questionId: String, optionId: String) {
        guard let attempt, attempt.isDraft, !completing, !reloadRequired, !isReloading else { return }
        answers[questionId] = optionId
        scheduleAutosave()
    }

    private func scheduleAutosave() {
        autosaveTask?.cancel()
        autosaveTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 900_000_000)
            if Task.isCancelled { return }
            guard let self, self.isDirty, !self.isWriting, !self.reloadRequired, !self.isReloading, self.failure == nil else { return }
            _ = await self.write(complete: false)
        }
    }

    // MARK: - Writes

    @discardableResult
    func write(complete: Bool) async -> Bool {
        guard let current = attempt, current.isDraft, !isWriting, !reloadRequired, !isReloading else { return false }
        isWriting = true
        failure = nil
        // Неподтверждённый запрос повторяется как есть: тот же request_id и
        // тот же снимок ответов — сервер вернёт исходный receipt.
        let request = pendingWrite ?? PendingWrite(
            requestId: UUID(),
            expectedRevision: current.revision,
            answers: answers,
            complete: complete
        )
        pendingWrite = request
        completing = request.complete
        defer { isWriting = false }
        do {
            let updated: AssessmentAttempt
            if request.complete {
                updated = try await service.completeAssessment(
                    attemptId: current.attemptId,
                    expectedRevision: request.expectedRevision,
                    answers: request.answers,
                    requestId: request.requestId
                )
            } else {
                updated = try await service.saveAssessmentAnswers(
                    attemptId: current.attemptId,
                    expectedRevision: request.expectedRevision,
                    answers: request.answers,
                    requestId: request.requestId
                )
            }
            attempt = updated
            savedFingerprint = fingerprint(request.answers)
            pendingWrite = nil
            completing = false
            if updated.isCompleted {
                answers = updated.answers
            }
            return true
        } catch {
            let kind = classify(error)
            failure = WriteFailure(kind: kind)
            if kind == .conflict { reloadRequired = true }
            if kind != .network {
                // Повторять тот же запрос бессмысленно; для conflict нужен
                // явный reload, для denied/rejected — состояние не меняем.
                pendingWrite = nil
                completing = false
            }
            return false
        }
    }

    /// «Сохранить и выйти»: true — выходить безопасно (всё подтверждено).
    func flushBeforeExit() async -> Bool {
        guard !reloadRequired, !isReloading else { return false }
        guard let attempt else { return true }
        if !attempt.isDraft { return true }
        if !hasUnconfirmedWork { return true }
        guard await write(complete: pendingWrite?.complete ?? false) else { return false }
        // A replay can confirm an older snapshot while newer answers remain visible.
        return !hasUnconfirmedWork
    }

    // MARK: - Helpers

    private func fingerprint(_ answers: [String: String]) -> String {
        answers.sorted(by: { $0.key < $1.key })
            .map { "\($0.key)=\($0.value)" }
            .joined(separator: "&")
    }

    private func classify(_ error: Error) -> WriteFailureKind {
        if let postgrest = error as? PostgrestError {
            switch postgrest.code {
            case "40001": return .conflict
            case "42501": return .denied
            default: return .rejected
            }
        }
        if error is URLError { return .network }
        return .network
    }
}

struct AssessmentRunnerView: View {
    let context: AssessmentRunContext

    @StateObject private var model = AssessmentRunnerModel()
    @Environment(\.dismiss) private var dismiss
    @State private var isExiting = false
    @State private var confirmReload = false
    // A11y (9b): буллеты инструкции масштабируются с Dynamic Type вместо
    // фиксированных 5pt.
    @ScaledMetric(relativeTo: .subheadline) private var bulletSize: CGFloat = 5

    var body: some View {
        NavigationStack {
            Group {
                if let attempt = model.attempt {
                    if attempt.isCompleted {
                        ScrollView {
                            AssessmentResultView(attempt: attempt)
                                .padding(20)
                        }
                    } else {
                        runningBody(attempt)
                    }
                } else if let message = model.loadFailedMessage {
                    VStack(spacing: 12) {
                        Text("tests_unavailable")
                            .multilineTextAlignment(.center)
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button("retry_button") {
                            Task { await openAttempt() }
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(32)
                } else if context.draftAttemptId != nil || model.isStarting {
                    ProgressView()
                } else {
                    introBody
                }
            }
            .navigationTitle(context.instrument.metadata.title ?? context.instrument.instrumentKey)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    exitButton
                }
            }
            .task {
                if model.attempt == nil, let draftId = context.draftAttemptId {
                    await model.loadDraft(attemptId: draftId)
                }
            }
        }
        .interactiveDismissDisabled(model.hasUnconfirmedWork)
    }

    private func openAttempt() async {
        if let draftId = context.draftAttemptId {
            await model.loadDraft(attemptId: draftId)
        } else {
            await model.start(instrumentKey: context.instrument.instrumentKey)
        }
    }

    private var exitButton: some View {
        Button {
            Task {
                isExiting = true
                if await model.flushBeforeExit() {
                    dismiss()
                }
                isExiting = false
            }
        } label: {
            if isExiting {
                ProgressView()
            } else if model.attempt?.isDraft == true {
                Text("runner_save_exit")
            } else {
                Text("runner_close")
            }
        }
        .disabled(isExiting || model.isWriting || model.isReloading || model.reloadRequired)
        // A11y (9b): во время выхода label — ProgressView без текста.
        .accessibilityLabel(model.attempt?.isDraft == true
            ? Text("runner_save_exit")
            : Text("runner_close"))
    }

    // MARK: - Intro

    private var introBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("runner_intro_title")
                    .font(.title3.bold())
                if let instructions = context.instrument.metadata.instructions {
                    ForEach(instructions, id: \.self) { line in
                        Label {
                            Text(line)
                        } icon: {
                            Image(systemName: "circle.fill")
                                .font(.system(size: bulletSize))
                                .padding(.top, 7)
                                // A11y (9b): буллет — декорация.
                                .accessibilityHidden(true)
                        }
                        .font(.subheadline)
                    }
                }
                Text(String(
                    format: String(localized: "tests_question_count"),
                    context.instrument.questionCount
                ))
                .font(.footnote)
                .foregroundStyle(.secondary)
                Text("runner_intro_note")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if let limitations = context.instrument.metadata.limitations {
                    DisclosureGroup("runner_limitations_heading") {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(limitations, id: \.self) { line in
                                Text("• \(line)")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 6)
                    }
                    .font(.subheadline.weight(.medium))
                }

                Button {
                    Task { await model.start(instrumentKey: context.instrument.instrumentKey) }
                } label: {
                    Group {
                        if model.isStarting {
                            ProgressView()
                        } else {
                            Text("tests_start")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                // A11y (9b): во время старта label — ProgressView.
                .accessibilityLabel(Text("tests_start"))
                .disabled(model.isStarting)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Running

    private func runningBody(_ attempt: AssessmentAttempt) -> some View {
        let total = attempt.questions.count
        let review = model.pageIndex >= total
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                progressCard(total: total)
                failureCard
                if review {
                    reviewCard(total: total)
                } else if model.pageIndex < total {
                    questionCard(attempt.questions[model.pageIndex], total: total)
                }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.immediately)
    }

    private func progressCard(total: Int) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(String(
                    format: String(localized: "runner_progress"),
                    model.answeredCount, total
                ))
                .font(.subheadline.weight(.medium))
                Spacer()
                saveStateLabel
            }
            ProgressView(value: Double(model.answeredCount), total: Double(max(total, 1)))
                .tint(Color("AccentColor"))
        }
        .padding(14)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    private var saveStateLabel: some View {
        Group {
            if model.isWriting {
                Text("runner_saving")
            } else if model.failure != nil {
                Text("runner_save_unconfirmed")
            } else if model.isDirty {
                Text("runner_unsaved")
            } else {
                Text("runner_saved")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private var failureCard: some View {
        if let failure = model.failure {
            VStack(alignment: .leading, spacing: 10) {
                Text(failureMessage(failure.kind))
                    .font(.footnote)
                switch failure.kind {
                case .network:
                    if model.reloadRequired {
                        Button("runner_load_saved") {
                            Task { await model.reloadSavedAttempt() }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.isReloading)
                    } else {
                        Button("runner_retry_save") {
                            Task { await model.write(complete: false) }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.isWriting)
                    }
                case .conflict:
                    Button("runner_load_saved") {
                        confirmReload = true
                    }
                    .buttonStyle(.bordered)
                    .disabled(model.isReloading)
                    .confirmationDialog(
                        "runner_load_saved_confirm",
                        isPresented: $confirmReload,
                        titleVisibility: .visible
                    ) {
                        Button("runner_load_saved", role: .destructive) {
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

    private func failureMessage(_ kind: AssessmentRunnerModel.WriteFailureKind) -> LocalizedStringKey {
        switch kind {
        case .network: return model.reloadRequired ? "runner_error_conflict" : "runner_error_network"
        case .conflict: return "runner_error_conflict"
        case .denied: return "runner_error_denied"
        case .rejected: return "runner_error_rejected"
        }
    }

    private func questionCard(_ question: AssessmentQuestion, total: Int) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(String(
                format: String(localized: "runner_question_n"),
                model.pageIndex + 1, total
            ))
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)

            if let passage = question.passage {
                Text(passage)
                    .font(.subheadline)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            }

            Text(question.prompt)
                .font(.body.weight(.medium))

            VStack(spacing: 8) {
                ForEach(question.options) { option in
                    optionButton(question: question, option: option)
                }
            }

            HStack {
                Button("runner_back") {
                    model.pageIndex = max(model.pageIndex - 1, 0)
                }
                .buttonStyle(.bordered)
                .disabled(model.pageIndex == 0 || model.completing)

                Spacer()

                Button(model.pageIndex + 1 == total ? "runner_to_review" : "runner_next") {
                    model.pageIndex += 1
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .disabled(model.completing || model.reloadRequired || model.isReloading)
            }
            .padding(.top, 4)
        }
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    private func optionButton(question: AssessmentQuestion, option: AssessmentOption) -> some View {
        let selected = model.answers[question.id] == option.id
        return Button {
            model.select(questionId: question.id, optionId: option.id)
        } label: {
            HStack {
                Image(systemName: selected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(selected ? Color("AccentColor") : Color.secondary)
                    // A11y (9b): кружок — декорация, состояние несёт trait.
                    .accessibilityHidden(true)
                Text(option.label)
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
        .disabled(model.completing || model.reloadRequired || model.isReloading)
        // A11y (9b): выбранность варианта — не только цвет/иконка.
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private func reviewCard(total: Int) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("runner_review_title")
                .font(.title3.bold())
            if model.answeredCount == total {
                Text("runner_review_all_answered")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Text(String(
                    format: String(localized: "runner_review_remaining"),
                    total - model.answeredCount
                ))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                Button("runner_first_unanswered") {
                    model.pageIndex = model.firstUnansweredIndex
                }
                .buttonStyle(.bordered)
            }

            HStack {
                Button("runner_back") {
                    model.pageIndex = max(total - 1, 0)
                }
                .buttonStyle(.bordered)
                .disabled(model.completing || model.reloadRequired || model.isReloading)

                Spacer()

                Button {
                    Task { await model.write(complete: true) }
                } label: {
                    if model.completing && model.isWriting {
                        ProgressView()
                    } else {
                        Text("runner_complete")
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .disabled(model.answeredCount != total || model.isWriting || model.failure != nil || model.reloadRequired || model.isReloading)
                // A11y (9b): во время завершения label — ProgressView.
                .accessibilityLabel(Text("runner_complete"))
            }
            .padding(.top, 4)
        }
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}
