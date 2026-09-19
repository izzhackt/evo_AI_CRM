import SwiftUI

/// Вкладка «Английский» (миграции 198/199, READ-слой): карта модуля с
/// собственным прогрессом и просмотр урока (цель, теория, состав заданий).
/// Прохождение уроков (start/save/complete) на iPhone — отдельный слайс;
/// экран урока честно говорит об этом, ничего не имитируя.
@MainActor
final class EnglishViewModel: ObservableObject {
    @Published var modules: [LearningModule] = []
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
            modules = try await service.learningModules().modules
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct EnglishView: View {
    @StateObject private var model = EnglishViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.modules.isEmpty {
                    ProgressView()
                } else if let errorMessage = model.errorMessage, model.modules.isEmpty {
                    VStack(spacing: 12) {
                        Text("english_unavailable")
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
                } else if model.modules.isEmpty {
                    VStack(spacing: 8) {
                        Text("english_empty_title")
                            .font(.headline)
                        Text("english_empty_body")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(32)
                } else {
                    moduleList
                }
            }
            .navigationTitle("tab_english")
            .navigationDestination(for: UUID.self) { lessonId in
                LessonContentView(lessonId: lessonId)
            }
            .task {
                if model.modules.isEmpty {
                    await model.load()
                }
            }
        }
    }

    private var moduleList: some View {
        List {
            ForEach(model.modules) { module in
                Section {
                    ForEach(module.lessons) { lesson in
                        NavigationLink(value: lesson.lessonId) {
                            LessonRow(lesson: lesson)
                        }
                    }

                    // Вход в тест english36 — из раздела (дизайн-контракт §4).
                    NavigationLink {
                        TestsContentView()
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("english_test_entry")
                                .font(.subheadline.weight(.medium))
                            Text("english_test_entry_hint")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(AppLocale.pick(
                            ru: module.metadata.titleRu,
                            ky: module.metadata.titleKy
                        ))
                        .font(.headline)
                        .textCase(nil)
                        Text(String(
                            format: String(localized: "english_progress"),
                            module.lessonsCompleted, module.lessonsTotal
                        ))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .textCase(nil)
                    }
                    .padding(.bottom, 4)
                } footer: {
                    Text(AppLocale.pick(
                        ru: module.metadata.levelNoteRu,
                        ky: module.metadata.levelNoteKy
                    ))
                }
            }
        }
        .refreshable { await model.load() }
    }
}

private struct LessonRow: View {
    let lesson: LearningLessonSummary

    private var statusKey: LocalizedStringKey {
        if lesson.completed { return "english_status_completed" }
        if lesson.draftAttemptId != nil { return "english_status_draft" }
        return "english_status_new"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(String(
                format: String(localized: "english_lesson_label"),
                lesson.orderIndex
            ))
            .font(.caption)
            .foregroundStyle(.secondary)
            Text(AppLocale.pick(ru: lesson.metadata.titleRu, ky: lesson.metadata.titleKy))
                .font(.subheadline.weight(.medium))
            HStack(spacing: 8) {
                Text(statusKey)
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(
                        lesson.completed
                            ? Color("AccentColor").opacity(0.12)
                            : Color(.secondarySystemBackground),
                        in: Capsule()
                    )
                if let result = lesson.lastResult {
                    Text(String(
                        format: String(localized: "english_last_result"),
                        result.correctCount, result.exercisesTotal
                    ))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Text(String(
                    format: String(localized: "english_exercises_count"),
                    lesson.exercisesTotal
                ))
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Экран урока (learning_lesson_v1): цель, теория с примерами и состав
/// заданий. Раннер уроков на iPhone — следующий слайс, о чём экран говорит
/// явно; ключи ответов сервер в эту проекцию не кладёт вовсе (198:519-561).
@MainActor
final class LessonContentViewModel: ObservableObject {
    @Published var lesson: LearningLessonResponse?
    @Published var isLoading = false
    @Published var loadFailed = false

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func load(lessonId: UUID) async {
        if isLoading { return }
        isLoading = true
        loadFailed = false
        do {
            lesson = try await service.learningLesson(lessonId: lessonId)
        } catch {
            loadFailed = true
        }
        isLoading = false
    }
}

struct LessonContentView: View {
    let lessonId: UUID

    @StateObject private var model = LessonContentViewModel()

    var body: some View {
        Group {
            if let response = model.lesson {
                content(response)
            } else if model.isLoading {
                ProgressView()
            } else {
                VStack(spacing: 12) {
                    Text("english_unavailable")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("retry_button") {
                        Task { await model.load(lessonId: lessonId) }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(32)
            }
        }
        .task { await model.load(lessonId: lessonId) }
    }

    private func content(_ response: LearningLessonResponse) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(String(
                        format: String(localized: "english_lesson_label"),
                        response.lesson.orderIndex
                    ))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    Text(AppLocale.pick(
                        ru: response.lesson.metadata.titleRu,
                        ky: response.lesson.metadata.titleKy
                    ))
                    .font(.title2.bold())
                }

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
                    TheoryBlockView(block: block)
                }

                // Честная граница слайса: контент читается, раннер — позже.
                VStack(alignment: .leading, spacing: 6) {
                    Text(String(
                        format: String(localized: "english_exercises_count"),
                        response.lesson.exercises.count
                    ))
                    .font(.subheadline.weight(.medium))
                    Text("english_runner_coming")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))

                if let draft = response.draft {
                    Text(String(
                        format: String(localized: "english_draft_note"),
                        draft.answeredCount, draft.exercisesTotal
                    ))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
                if let completed = response.latestCompleted, let result = completed.result {
                    Text(String(
                        format: String(localized: "english_last_result"),
                        result.correctCount, result.exercisesTotal
                    ))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(20)
        }
        .navigationTitle(AppLocale.pick(
            ru: response.lesson.metadata.titleRu,
            ky: response.lesson.metadata.titleKy
        ))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load(lessonId: lessonId) }
    }
}

private struct TheoryBlockView: View {
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
