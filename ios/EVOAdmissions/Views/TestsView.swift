import SwiftUI

@MainActor
final class TestsViewModel: ObservableObject {
    @Published var catalog: AssessmentCatalog?
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func load() async {
        if isLoading { return }
        isLoading = true
        errorMessage = nil
        do {
            catalog = try await service.studentAssessments()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func instrument(for key: String) -> AssessmentInstrumentSummary? {
        catalog?.instruments.first(where: { $0.instrumentKey == key })
    }
}

/// Контекст запуска раннера: инструмент плюс продолжаемая попытка (если есть).
struct AssessmentRunContext: Identifiable {
    let instrument: AssessmentInstrumentSummary
    let draftAttemptId: UUID?

    var id: String {
        "\(instrument.instrumentKey):\(draftAttemptId?.uuidString ?? "new")"
    }
}

/// Обёртка с собственным NavigationStack (использовалась вкладкой «Тесты»;
/// после переноса тестов внутрь разделов остаётся для standalone-показов).
struct TestsView: View {
    var body: some View {
        NavigationStack {
            TestsContentView()
        }
    }
}

/// Каталог тестов, пригодный для push из «Английский», «Профессии» и
/// «Профиль» (дизайн-контракт: Тесты — не отдельная вкладка, а входы из
/// разделов и личные результаты в профиле).
struct TestsContentView: View {
    @StateObject private var model = TestsViewModel()
    @State private var runContext: AssessmentRunContext?

    var body: some View {
        Group {
            if model.isLoading && model.catalog == nil {
                ProgressView()
            } else if let errorMessage = model.errorMessage, model.catalog == nil {
                VStack(spacing: 12) {
                    Text("tests_unavailable")
                        .font(.body)
                        .multilineTextAlignment(.center)
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("retry_button") {
                        Task { await model.load() }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(32)
            } else if let catalog = model.catalog {
                catalogList(catalog)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("tab_tests")
        .task {
            if model.catalog == nil {
                await model.load()
            }
        }
        .fullScreenCover(item: $runContext, onDismiss: {
            Task { await model.load() }
        }) { context in
            AssessmentRunnerView(context: context)
        }
    }

    private func catalogList(_ catalog: AssessmentCatalog) -> some View {
        List {
            Section {
                ForEach(catalog.instruments) { instrument in
                    InstrumentCard(instrument: instrument) {
                        runContext = AssessmentRunContext(
                            instrument: instrument,
                            draftAttemptId: instrument.draftAttemptId
                        )
                    }
                }
            } footer: {
                Text("tests_privacy_note")
            }

            Section("tests_history_heading") {
                if catalog.attempts.isEmpty {
                    Text("tests_history_empty")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(catalog.attempts) { attempt in
                        attemptRow(attempt)
                    }
                }
            }
        }
        .refreshable { await model.load() }
    }

    @ViewBuilder
    private func attemptRow(_ attempt: AssessmentAttemptSummary) -> some View {
        if attempt.isDraft {
            Button {
                if let instrument = model.instrument(for: attempt.instrumentKey) {
                    runContext = AssessmentRunContext(
                        instrument: instrument,
                        draftAttemptId: attempt.attemptId
                    )
                }
            } label: {
                AttemptSummaryRow(attempt: attempt, model: model)
            }
            .buttonStyle(.plain)
        } else {
            NavigationLink {
                AssessmentResultScreen(attemptId: attempt.attemptId)
            } label: {
                AttemptSummaryRow(attempt: attempt, model: model)
            }
        }
    }
}

private struct InstrumentCard: View {
    let instrument: AssessmentInstrumentSummary
    let onRun: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(instrument.metadata.title ?? instrument.instrumentKey)
                .font(.headline)
            if let description = instrument.metadata.description {
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text(String(format: String(localized: "tests_question_count"), instrument.questionCount))
                .font(.footnote)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                Button {
                    onRun()
                } label: {
                    Text(instrument.draftAttemptId == nil ? "tests_start" : "tests_continue")
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))

                if let completedId = instrument.latestCompletedAttemptId {
                    NavigationLink {
                        AssessmentResultScreen(attemptId: completedId)
                    } label: {
                        Text("tests_last_result")
                    }
                    .buttonStyle(.bordered)
                }
            }
            .padding(.top, 4)
        }
        .padding(.vertical, 6)
    }
}

private struct AttemptSummaryRow: View {
    let attempt: AssessmentAttemptSummary
    @ObservedObject var model: TestsViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.instrument(for: attempt.instrumentKey)?.metadata.title ?? attempt.instrumentKey)
                .font(.subheadline.weight(.semibold))
            HStack(spacing: 8) {
                Text(attempt.isDraft ? "attempt_status_draft" : "attempt_status_completed")
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(
                        attempt.isDraft
                            ? Color.orange.opacity(0.15)
                            : Color.green.opacity(0.15),
                        in: Capsule()
                    )
                Text(String(
                    format: String(localized: "attempt_answered_of"),
                    attempt.answeredCount, attempt.questionCount
                ))
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            if let dateLabel = PostgresTimestamp.dayLabel(
                from: attempt.completedAt ?? attempt.createdAt,
                locale: AppLocale.current
            ) {
                Text(dateLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Экран результата из истории: честная загрузка полной попытки по id.
struct AssessmentResultScreen: View {
    let attemptId: UUID

    @State private var attempt: AssessmentAttempt?
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        Group {
            if let attempt, attempt.result != nil {
                ScrollView {
                    AssessmentResultView(attempt: attempt)
                        .padding(20)
                }
            } else if isLoading {
                ProgressView()
            } else if let errorMessage {
                VStack(spacing: 12) {
                    Text("tests_unavailable")
                        .multilineTextAlignment(.center)
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("retry_button") { Task { await load() } }
                        .buttonStyle(.bordered)
                }
                .padding(32)
            } else {
                // Попытка без result — черновик; экран результата для неё не по адресу.
                Text("tests_attempt_not_completed")
                    .foregroundStyle(.secondary)
                    .padding(32)
            }
        }
        .navigationTitle("tests_result_title")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            attempt = try await SupabaseService.shared.studentAssessmentAttempt(id: attemptId)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
