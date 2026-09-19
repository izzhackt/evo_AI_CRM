import SwiftUI

/// Локализованная подпись шкалы ORVIS (те же 8 id, что в валидаторе 198:357-358).
func orvisScaleLabel(_ scale: String) -> String {
    let key: String.LocalizationValue
    switch scale {
    case "leadership": key = "orvis_scale_leadership"
    case "organization": key = "orvis_scale_organization"
    case "altruism": key = "orvis_scale_altruism"
    case "creativity": key = "orvis_scale_creativity"
    case "analysis": key = "orvis_scale_analysis"
    case "production": key = "orvis_scale_production"
    case "adventure": key = "orvis_scale_adventure"
    case "erudition": key = "orvis_scale_erudition"
    default: return scale
    }
    return String(localized: key)
}

/// «Профессии» (миграции 198/199): сетка карточек по интересам и карточка
/// профессии со связками в каталог вузов. Контент публикуемый; зарплат и
/// «шансов» нет — только описания с источником (план §6/§14).
@MainActor
final class ProfessionsViewModel: ObservableObject {
    @Published var cards: [ProfessionCardSummary] = []
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
            cards = try await service.professionCards().cards
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

/// Обёртка с NavigationStack — вкладка approved-тира.
struct ProfessionsView: View {
    var body: some View {
        NavigationStack {
            ProfessionsContentView()
        }
    }
}

/// Содержимое раздела, пригодное и для push из «Главной» (assisted-тир, у
/// которого «Профессии» не в таб-баре — дизайн-контракт «Карта экранов»).
struct ProfessionsContentView: View {
    @StateObject private var model = ProfessionsViewModel()

    private let columns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12),
    ]

    var body: some View {
        Group {
            if model.isLoading && model.cards.isEmpty {
                ProgressView()
            } else if let errorMessage = model.errorMessage, model.cards.isEmpty {
                VStack(spacing: 12) {
                    Text("professions_unavailable")
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
            } else {
                grid
            }
        }
        .navigationTitle("tab_professions")
        .navigationDestination(for: UUID.self) { cardId in
            ProfessionCardView(cardId: cardId)
        }
        .task {
            if model.cards.isEmpty {
                await model.load()
            }
        }
    }

    private var grid: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("professions_lead")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                // Вход в тест интересов orvis92 (дизайн-контракт §3).
                NavigationLink {
                    TestsContentView()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("professions_test_entry")
                            .font(.subheadline.weight(.medium))
                        Text("professions_test_entry_hint")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)

                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(model.cards) { card in
                        NavigationLink(value: card.cardId) {
                            ProfessionTile(card: card)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(20)
        }
        .refreshable { await model.load() }
    }
}

private struct ProfessionTile: View {
    let card: ProfessionCardSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(AppLocale.pick(ru: card.titleRu, ky: card.titleKy))
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
            // Первая шкала — основная (валидатор 198:353).
            if let primary = card.orvisScales.first {
                Text(orvisScaleLabel(primary))
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color("AccentColor").opacity(0.12), in: Capsule())
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }
}

/// Карточка профессии: день/среда/навыки/интересное-сложное/пробное задание/
/// куда учиться. Связки «куда учиться» резолвятся против каталога по
/// institution_photo_key → content.photoKey (паттерн веба, professions.ts):
/// не найденное честно остаётся текстом без ссылки.
@MainActor
final class ProfessionCardViewModel: ObservableObject {
    struct ResolvedProgramRef: Identifiable {
        let ref: ProfessionLinkedProgramRef
        let institution: UniversityCatalogItem?
        let programFound: Bool

        var id: String { ref.institutionPhotoKey + "|" + ref.programHint }
    }

    @Published var card: ProfessionCardResponse?
    @Published var resolvedRefs: [ResolvedProgramRef] = []
    /// true, когда каталог для связок не удалось дочитать: ссылки могут
    /// отсутствовать не потому, что вуза нет, — экран говорит об этом честно.
    @Published var refsIncomplete = false
    @Published var isLoading = false
    @Published var loadFailed = false

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func load(cardId: UUID) async {
        if isLoading { return }
        isLoading = true
        loadFailed = false
        do {
            let card = try await service.professionCard(cardId: cardId)
            self.card = card
            await resolveRefs(card.body.linkedProgramRefs)
        } catch {
            loadFailed = true
        }
        isLoading = false
    }

    /// Полный каталог теми же студенческими страницами, что список вузов
    /// (потолок страницы 30, 148); фолбэк — честный текст без ссылки.
    private func resolveRefs(_ refs: [ProfessionLinkedProgramRef]) async {
        var universities: [UniversityCatalogItem] = []
        var offset: Int? = 0
        refsIncomplete = false
        do {
            while let current = offset {
                let page = try await service.studentUniversityCatalog(offset: current)
                universities.append(contentsOf: page.items)
                if let next = page.nextOffset, next > current {
                    offset = next
                } else {
                    offset = nil
                }
            }
        } catch {
            refsIncomplete = true
        }
        resolvedRefs = refs.map { ref in
            let institution = universities.first { $0.content.photoKey == ref.institutionPhotoKey }
            return ResolvedProgramRef(
                ref: ref,
                institution: institution,
                programFound: institution?.content.programs
                    .contains { $0.title == ref.programHint } ?? false
            )
        }
    }
}

struct ProfessionCardView: View {
    let cardId: UUID

    @StateObject private var model = ProfessionCardViewModel()

    var body: some View {
        Group {
            if let card = model.card {
                content(card)
            } else if model.isLoading {
                ProgressView()
            } else {
                VStack(spacing: 12) {
                    Text("professions_unavailable")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("retry_button") {
                        Task { await model.load(cardId: cardId) }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(32)
            }
        }
        .task { await model.load(cardId: cardId) }
    }

    private func content(_ card: ProfessionCardResponse) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(AppLocale.pick(ru: card.body.titleRu, ky: card.body.titleKy))
                        .font(.title2.bold())
                    HStack(spacing: 6) {
                        ForEach(card.body.orvisScales, id: \.self) { scale in
                            Text(orvisScaleLabel(scale))
                                .font(.caption)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 2)
                                .background(Color("AccentColor").opacity(0.12), in: Capsule())
                        }
                    }
                }

                textSection(
                    "professions_day_heading",
                    AppLocale.pick(ru: card.body.dayInWorkRu, ky: card.body.dayInWorkKy)
                )
                textSection(
                    "professions_environment_heading",
                    AppLocale.pick(ru: card.body.environmentRu, ky: card.body.environmentKy)
                )
                listSection(
                    "professions_skills_heading",
                    AppLocale.isKyrgyz ? card.body.skillsKy : card.body.skillsRu
                )
                listSection(
                    "professions_interesting_heading",
                    AppLocale.isKyrgyz ? card.body.interestingKy : card.body.interestingRu
                )
                listSection(
                    "professions_hard_heading",
                    AppLocale.isKyrgyz ? card.body.hardKy : card.body.hardRu
                )
                textSection(
                    "professions_trial_heading",
                    AppLocale.pick(ru: card.body.trialTaskRu, ky: card.body.trialTaskKy)
                )
                listSection(
                    "professions_study_heading",
                    AppLocale.isKyrgyz ? card.body.studyDirectionsKy : card.body.studyDirectionsRu
                )

                programsSection

                sourcesSection(card.body.sources)
            }
            .padding(20)
        }
        .navigationTitle(AppLocale.pick(ru: card.body.titleRu, ky: card.body.titleKy))
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.load(cardId: cardId) }
    }

    private func textSection(_ key: LocalizedStringKey, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(key)
                .font(.headline)
            Text(text)
                .font(.body)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func listSection(_ key: LocalizedStringKey, _ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(key)
                .font(.headline)
            ForEach(items, id: \.self) { item in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("•")
                    Text(item)
                        .font(.body)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var programsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("professions_programs_heading")
                .font(.headline)
            ForEach(model.resolvedRefs) { resolved in
                VStack(alignment: .leading, spacing: 4) {
                    Text(String(
                        format: String(localized: "professions_program_label"),
                        resolved.ref.programHint
                    ))
                    .font(.subheadline)
                    if let institution = resolved.institution {
                        NavigationLink {
                            UniversityDetailView(
                                institutionId: institution.id,
                                initialItem: institution
                            )
                        } label: {
                            Label(institution.content.name, systemImage: "building.columns")
                                .font(.footnote)
                        }
                        if !resolved.programFound {
                            Text("professions_program_missing")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text("professions_university_missing")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
            }
            if model.refsIncomplete {
                // Каталог не дочитался: отсутствие ссылок — не факт о вузе.
                Text("professions_refs_incomplete")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func sourcesSection(_ sources: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("professions_sources_heading")
                .font(.headline)
            ForEach(sources, id: \.self) { source in
                if let url = URL(string: source) {
                    Link(source, destination: url)
                        .font(.caption)
                } else {
                    Text(source)
                        .font(.caption)
                }
            }
            // Атрибуция O*NET / CC BY 4.0 (паттерн orvis-v1, PORT-4c (d)).
            Text("professions_attribution")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
