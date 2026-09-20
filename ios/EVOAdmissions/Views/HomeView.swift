import SwiftUI

private enum HomeRead<Value> {
    case loading
    case loaded(Value)
    case failed
}

/// Independent real read paths: a failed section never becomes a false empty state.
@MainActor
private final class HomeViewModel: ObservableObject {
    @Published var lessons: HomeRead<[LearningModule]> = .loading
    @Published var tests: HomeRead<AssessmentCatalog> = .loading
    @Published var favorites: HomeRead<[UniversityCatalogItem]> = .loading
    @Published var application: HomeRead<StudentApplication?> = .loading
    private var refreshing = false

    func refresh(tier: AccessTier, admission: AdmissionHubModel) async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        async let learning: () = loadLessons()
        async let assessments: () = loadTests()
        async let saved: () = loadFavorites()
        if tier == .assisted { await admission.load() }
        else { await loadApplication() }
        _ = await (learning, assessments, saved)
    }

    func loadLessons() async {
        do { lessons = .loaded(try await SupabaseService.shared.learningModules().modules) }
        catch { if !Task.isCancelled { lessons = .failed } }
    }
    func loadTests() async {
        do { tests = .loaded(try await SupabaseService.shared.studentAssessments()) }
        catch { if !Task.isCancelled { tests = .failed } }
    }
    func loadFavorites() async {
        do {
            let saved = try await SupabaseService.shared.studentUniversityFavorites()
            let ids = Array(saved.prefix(4).map(\.institutionId))
            if ids.isEmpty { favorites = .loaded([]); return }
            let page = try await SupabaseService.shared.studentUniversityCatalogByIds(institutionIds: ids)
            let ordered = ids.compactMap { id in page.items.first { $0.id == id } }
            guard ordered.count == ids.count else { favorites = .failed; return }
            favorites = .loaded(ordered)
        } catch { if !Task.isCancelled { favorites = .failed } }
    }
    func loadApplication() async {
        do { application = .loaded(try await SupabaseService.shared.ownStudentApplication()) }
        catch { if !Task.isCancelled { application = .failed } }
    }
}

struct HomeView: View {
    let session: SessionRouter.PortalSession
    @ObservedObject var router: SessionRouter
    @Binding var selectedTab: PortalTab
    @StateObject private var model = HomeViewModel()
    @StateObject private var admission = AdmissionHubModel()
    @State private var runContext: AssessmentRunContext?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(session.authority.displayName).font(.title2.bold())
                }
                if session.accessTier == .assisted { admissionSection }
                learningSection
                testsSection
                if session.accessTier == .approved { applicationSection }
                favoritesSection
                if session.accessTier == .assisted {
                    Section {
                        NavigationLink {
                            ProfessionsContentView()
                        } label: {
                            Label("tab_professions", systemImage: "person.text.rectangle")
                        }
                    }
                }
            }
            .navigationTitle("tab_home")
            .refreshable { await refresh() }
            .task { await refresh() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await refresh() } }
            }
            .fullScreenCover(item: $runContext, onDismiss: {
                Task { await model.loadTests() }
            }) { context in
                AssessmentRunnerView(context: context)
            }
        }
    }

    private func refresh() async {
        await model.refresh(tier: session.accessTier, admission: admission)
    }

    private var admissionSection: some View {
        Section("home_admission_heading") {
            if admission.loadFailed {
                retryRow("adm_section_unavailable") { await admission.load() }
            } else if !admission.isLoaded {
                ProgressView()
            } else {
                if let stage = admission.overview.flatMap({ AdmissionStageLabel.key(for: $0.operationalStage) }) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("adm_stage_label").font(.caption).foregroundStyle(.secondary)
                        Text(stage).font(.headline)
                    }
                    .accessibilityElement(children: .combine)
                }
                if let action = admission.primaryAction {
                    AdmissionActionRow(action: action, isPrimary: true)
                } else {
                    Text(admission.overview == nil ? "adm_calm_no_plan" : "adm_calm_done")
                        .foregroundStyle(.secondary)
                }
                Button("home_open_admission") { selectedTab = .admission }
            }
        }
    }

    private var learningSection: some View {
        Section("home_learning_heading") {
            switch model.lessons {
            case .loading: ProgressView()
            case .failed:
                retryRow("english_unavailable") { await model.loadLessons() }
            case .loaded(let modules):
                if let picked = Self.pickLesson(modules) {
                    NavigationLink {
                        LessonContentView(lessonId: picked.lesson.lessonId)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(AppLocale.pick(ru: picked.lesson.metadata.titleRu, ky: picked.lesson.metadata.titleKy))
                                .font(.headline)
                            Text(String(format: String(localized: "home_module_progress"), picked.module.lessonsCompleted, picked.module.lessonsTotal))
                                .font(.subheadline).foregroundStyle(.secondary)
                            Text(picked.lesson.draftAttemptId == nil ? "home_start_lesson" : "home_resume_lesson")
                                .foregroundStyle(.tint)
                        }
                        .padding(.vertical, 4)
                    }
                } else {
                    Text(modules.contains { !$0.lessons.isEmpty } ? "home_lessons_done" : "english_empty_title")
                        .foregroundStyle(.secondary)
                }
                Button("home_open_english") { selectedTab = .english }
            }
        }
    }

    private var testsSection: some View {
        Section("tab_tests") {
            switch model.tests {
            case .loading: ProgressView()
            case .failed:
                retryRow("tests_unavailable") { await model.loadTests() }
            case .loaded(let catalog):
                if let instrument = catalog.instruments.first(where: { $0.draftAttemptId != nil }) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(instrument.metadata.title ?? instrument.instrumentKey).font(.headline)
                        if let attempt = catalog.attempts.first(where: { $0.attemptId == instrument.draftAttemptId }) {
                            Text(String(format: String(localized: "home_test_progress"), attempt.answeredCount, attempt.questionCount))
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        Button("tests_continue") {
                            runContext = AssessmentRunContext(instrument: instrument, draftAttemptId: instrument.draftAttemptId)
                        }
                        .buttonStyle(.borderedProminent)
                        .frame(minHeight: 44)
                    }
                    .padding(.vertical, 4)
                }
                NavigationLink { TestsContentView() } label: { Text("home_open_tests") }
            }
        }
    }

    private var applicationSection: some View {
        Section("apply_status_kicker") {
            switch model.application {
            case .loading: ProgressView()
            case .failed:
                retryRow("home_application_unavailable") { await model.loadApplication() }
            case .loaded(let application):
                if let application {
                    NavigationLink {
                        ApplicationStatusView(router: router, application: application)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(LocalizedStringKey("apply_status_\(application.status.rawValue)_title"))
                                .font(.headline)
                            Text("home_open_application").foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Text("home_application_absent").foregroundStyle(.secondary)
                }
            }
        }
    }

    private var favoritesSection: some View {
        Section("favorites_title") {
            switch model.favorites {
            case .loading: ProgressView()
            case .failed:
                retryRow("favorites_unavailable") { await model.loadFavorites() }
            case .loaded(let items):
                if items.isEmpty {
                    Text("favorites_empty_title").foregroundStyle(.secondary)
                    Button("tab_universities") { selectedTab = .universities }
                }
                ForEach(items) { item in
                    NavigationLink {
                        UniversityDetailView(institutionId: item.id, initialItem: item)
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(item.content.name).font(.headline)
                            Text(nearestIntakeLabel(item.content, now: Date()))
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
                NavigationLink { FavoritesView() } label: { Text("home_all_favorites") }
            }
        }
    }

    private func retryRow(_ key: LocalizedStringKey, retry: @escaping () async -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(key).foregroundStyle(.secondary)
            Button("retry_button") { Task { await retry() } }.frame(minHeight: 44)
        }
    }

    private static func pickLesson(_ modules: [LearningModule]) -> (module: LearningModule, lesson: LearningLessonSummary)? {
        for module in modules {
            if let draft = module.lessons.first(where: { $0.draftAttemptId != nil }) { return (module, draft) }
        }
        for module in modules {
            if let next = module.lessons.first(where: { !$0.completed }) { return (module, next) }
        }
        return nil
    }

    private func nearestIntakeLabel(_ content: UniversityContent, now: Date) -> String {
        guard let nearest = nearestUniversityIntake(content, now: now) else {
            return String(localized: "home_intake_pending")
        }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(secondsFromGMT: 0)
        parser.dateFormat = nearest.kind == .startMonth ? "yyyy-MM" : "yyyy-MM-dd"
        guard let date = parser.date(from: nearest.value) else { return String(localized: "home_intake_pending") }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: AppLocale.isKyrgyz ? "ky_KG" : "ru_RU")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.setLocalizedDateFormatFromTemplate(nearest.kind == .startMonth ? "MMMM yyyy" : "d MMM yyyy")
        let label = nearest.kind == .deadline ? String(localized: "home_intake_deadline") : String(localized: "home_intake_start")
        return String(format: label, formatter.string(from: date))
    }
}
