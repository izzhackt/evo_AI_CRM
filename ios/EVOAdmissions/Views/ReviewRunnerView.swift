import SwiftUI
import Supabase

/// Режим повторения ошибок (миграция 198), зеркально веб-раннеру
/// (`src/components/portal/english/ReviewRunner.tsx`):
/// - банк ошибок модуля — learning_review_v1 (cap 20, новые первыми,
///   198:965-1002);
/// - проверка ответа — learning_review_check_v1: STATELESS, ничего не пишет
///   (198:1004-1032) — прогресс повторения живёт только на экране и честно
///   теряется при выходе;
/// - разборы упражнений собственного банка уже открыты завершённой попыткой,
///   инвариант «разбор только отвеченного» сохраняется (198:1004-1006).
///
/// Приватность: ответы и вердикты нигде не логируются.
@MainActor
final class ReviewRunnerModel: ObservableObject {
    enum Phase {
        case loading
        case loadFailed
        case empty
        case running
        case done
    }

    @Published private(set) var phase: Phase = .loading
    @Published private(set) var items: [LearningReviewItem] = []
    @Published private(set) var index = 0
    @Published var form = ExerciseFormValue(exercise: nil)
    @Published private(set) var checks: [UUID: LearningAnsweredEntry] = [:]
    @Published private(set) var isChecking = false
    @Published private(set) var failure: LearningWriteFailureKind?

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    var currentItem: LearningReviewItem? {
        guard phase == .running, items.indices.contains(index) else { return nil }
        return items[index]
    }

    var currentEntry: LearningAnsweredEntry? {
        guard let currentItem else { return nil }
        return checks[currentItem.exercise.exerciseId]
    }

    var canSubmit: Bool {
        guard let currentItem, currentEntry == nil, !isChecking else { return false }
        return form.answer(for: currentItem.exercise) != nil
    }

    var checkedCount: Int { checks.count }

    func load(moduleId: UUID) async {
        phase = .loading
        do {
            let response = try await service.learningReview(moduleId: moduleId)
            items = response.items
            index = 0
            checks = [:]
            phase = items.isEmpty ? .empty : .running
            resetForm()
        } catch {
            phase = .loadFailed
        }
    }

    /// Проверка честно stateless (198:1007-1032): без request-ledger'а,
    /// повтор после сетевой ошибки шлёт тот же payload и безопасен.
    func check() async {
        guard let item = currentItem, currentEntry == nil, !isChecking,
              let answer = form.answer(for: item.exercise) else { return }
        isChecking = true
        failure = nil
        do {
            let receipt = try await service.checkLearningReviewAnswer(
                exerciseId: item.exercise.exerciseId,
                answer: answer
            )
            checks[receipt.exerciseId] = LearningAnsweredEntry(
                answer: answer,
                correct: receipt.correct,
                verdict: receipt.verdict,
                explain: receipt.explain
            )
        } catch {
            failure = LearningWriteFailureKind.classify(
                postgrestCode: (error as? PostgrestError)?.code,
                isTransportError: error is URLError
            )
        }
        isChecking = false
    }

    func advance() {
        guard phase == .running else { return }
        failure = nil
        index += 1
        if index >= items.count {
            phase = .done
        }
        resetForm()
    }

    private func resetForm() {
        form = ExerciseFormValue(
            exercise: items.indices.contains(index) ? items[index].exercise : nil
        )
    }
}

struct ReviewRunnerView: View {
    let moduleId: UUID

    @StateObject private var model = ReviewRunnerModel()

    var body: some View {
        Group {
            switch model.phase {
            case .loading:
                ProgressView()
            case .loadFailed:
                VStack(spacing: 12) {
                    Text("english_unavailable")
                        .multilineTextAlignment(.center)
                    Button("retry_button") {
                        Task { await model.load(moduleId: moduleId) }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(32)
            case .empty:
                VStack(spacing: 8) {
                    Text("english_review_empty_title")
                        .font(.headline)
                    Text("english_review_empty_body")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(32)
            case .running:
                runningBody
            case .done:
                doneBody
            }
        }
        .navigationTitle("english_review_title")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.load(moduleId: moduleId) }
    }

    private var runningBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("english_review_lead")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                if let item = model.currentItem {
                    HStack {
                        Text(String(
                            format: String(localized: "english_exercise_counter"),
                            model.index + 1, model.items.count
                        ))
                        .font(.subheadline.weight(.medium))
                        Spacer()
                        Text(String(
                            format: String(localized: "english_review_item_from"),
                            item.lessonOrderIndex
                        ))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    .padding(14)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))

                    failureCard

                    VStack(alignment: .leading, spacing: 14) {
                        ExercisePromptView(exercise: item.exercise)
                        if let entry = model.currentEntry {
                            ExplainPanelView(exercise: item.exercise, entry: entry)
                            Button("english_next_button") {
                                model.advance()
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Color("AccentColor"))
                            .frame(maxWidth: .infinity, alignment: .trailing)
                        } else {
                            ExerciseFormView(
                                exercise: item.exercise,
                                form: $model.form,
                                disabled: model.isChecking
                            )
                            Button {
                                Task { await model.check() }
                            } label: {
                                Group {
                                    if model.isChecking {
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
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.immediately)
    }

    @ViewBuilder
    private var failureCard: some View {
        if let failure = model.failure {
            VStack(alignment: .leading, spacing: 10) {
                Text(failureMessage(failure))
                    .font(.footnote)
                if failure == .network {
                    Button("retry_button") {
                        Task { await model.check() }
                    }
                    .buttonStyle(.bordered)
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

    private var doneBody: some View {
        VStack(spacing: 12) {
            Text(String(
                format: String(localized: "english_review_done"),
                model.checkedCount, model.items.count
            ))
            .font(.title3.bold())
            Text("english_review_lead")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(32)
    }
}
