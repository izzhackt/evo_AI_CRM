import SwiftUI

/// Карточка вуза: свежая загрузка той же публикации через
/// `student_university_catalog(p_institution_id:)` (миграция 148). Пока идёт
/// запрос, показывается уже полученная в списке версия той же публикации;
/// при ошибке обновления — честная плашка, данные списка не выдаются за
/// свежие молча.
@MainActor
final class UniversityCardViewModel: ObservableObject {
    @Published var item: UniversityCatalogItem?
    @Published var isLoading = false
    @Published var refreshFailed = false
    @Published var cardMissing = false

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func load(institutionId: UUID) async {
        if isLoading { return }
        isLoading = true
        refreshFailed = false
        cardMissing = false
        do {
            if let fresh = try await service.studentUniversityCard(institutionId: institutionId) {
                item = fresh
            } else {
                cardMissing = true
            }
        } catch {
            refreshFailed = true
        }
        isLoading = false
    }
}

struct UniversityDetailView: View {
    let institutionId: UUID
    let initialItem: UniversityCatalogItem?

    @StateObject private var model = UniversityCardViewModel()
    @ObservedObject private var favorites = FavoritesStore.shared
    @State private var showsConsultationSheet = false

    private var item: UniversityCatalogItem? { model.item ?? initialItem }

    var body: some View {
        Group {
            if let item {
                content(for: item)
            } else if model.isLoading {
                ProgressView()
            } else if model.cardMissing {
                honestState("university_card_missing")
            } else {
                honestState("university_card_load_failed")
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                // Сердечко (195): optimistic + честный откат в FavoritesStore.
                FavoriteHeartButton(institutionId: institutionId, store: favorites)
            }
        }
        .alert("favorite_error", isPresented: $favorites.toggleFailed) {
            Button("ok_button", role: .cancel) {}
        }
        .sheet(isPresented: $showsConsultationSheet) {
            ConsultationRequestSheet(
                institutionId: institutionId,
                institutionName: item?.content.name
            )
        }
        .task {
            await model.load(institutionId: institutionId)
            await favorites.loadIfNeeded()
        }
    }

    private func honestState(_ key: LocalizedStringKey) -> some View {
        VStack(spacing: 12) {
            Text(key)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("retry_button") {
                Task { await model.load(institutionId: institutionId) }
            }
            .buttonStyle(.bordered)
        }
        .padding(32)
    }

    private func content(for item: UniversityCatalogItem) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(item.content.name)
                            .font(.title2.bold())
                            .accessibilityAddTraits(.isHeader)
                        Text(universityPlaceLine(item.content))
                            .font(.subheadline)
                        if !item.content.programs.isEmpty {
                            Button {
                                proxy.scrollTo("university-programs", anchor: .top)
                            } label: {
                                HStack(spacing: 8) {
                                    Text("university_programs_heading")
                                    Text(item.content.programs.count, format: .number)
                                        .fontWeight(.semibold)
                                    Spacer(minLength: 8)
                                    Image(systemName: "arrow.down")
                                        .accessibilityHidden(true)
                                }
                                .font(.subheadline)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityElement(children: .combine)
                        }
                    }

                    UniversityPhotoView(photoKey: item.content.photoKey)
                        .tint(.primary)

                    if model.refreshFailed {
                        Text("university_card_refresh_failed")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                    }

                    Text(item.content.overview)
                        .font(.body)

                    // Запрос консультации из карточки вуза (миграция 197).
                    Button {
                        showsConsultationSheet = true
                    } label: {
                        Label("consultation_cta", systemImage: "bubble.left.and.bubble.right")
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .buttonStyle(.borderedProminent)

                    Text("university_programs_heading")
                        .font(.title3.bold())
                        .accessibilityAddTraits(.isHeader)
                        .id("university-programs")

                    ForEach(item.content.programs) { program in
                        UniversityProgramCard(program: program)
                            .tint(.primary)
                    }

                    if !item.content.notes.isEmpty {
                        Text(item.content.notes)
                            .font(.footnote)
                    }

                    factsCard(item.content)
                        .tint(.primary)
                }
                .padding(20)
            }
        }
        .navigationTitle(item.content.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color(.systemBackground), for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .refreshable { await model.load(institutionId: institutionId) }
    }

    private func factsCard(_ content: UniversityContent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
                .padding(.bottom, 8)
            Text("university_official_information")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            if let verified = CatalogDate.dayLabel(from: content.verifiedOn, locale: AppLocale.current) {
                Text(String(format: String(localized: "university_verified_on"), verified))
                    .font(.footnote)
            }
            if let url = URL(string: content.websiteUrl) {
                Link(destination: url) {
                    Label("university_website", systemImage: "safari")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
            }
            if let url = URL(string: content.sourceUrl) {
                Link(destination: url) {
                    Label("university_card_source", systemImage: "doc.text.magnifyingglass")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Фото кампуса с сохранённой атрибуцией (та же библиотека и тот же честный
/// fallback, что у веб-`PhotoFigure`): подпись, автор со ссылкой на источник,
/// лицензия со ссылкой, пометка о кадрировании.
struct UniversityPhotoView: View {
    let photoKey: String?

    var body: some View {
        if let photo = UniversityPhotoLibrary.photo(for: photoKey),
           let url = URL(string: photo.path) {
            VStack(alignment: .leading, spacing: 8) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                            .frame(maxWidth: .infinity)
                            .frame(height: 180)
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                            .accessibilityLabel(photo.caption)
                    case .failure:
                        placeholder("university_photo_failed")
                    case .empty:
                        ZStack {
                            RoundedRectangle(cornerRadius: 14)
                                .fill(.thinMaterial)
                                .frame(height: 180)
                            ProgressView()
                        }
                    @unknown default:
                        placeholder("university_photo_failed")
                    }
                }

                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(photo.caption)
                            .font(.footnote)
                        if let sourceUrl = URL(string: photo.sourceUrl) {
                            Link(destination: sourceUrl) {
                                Text(String(format: String(localized: "university_photo_by"), photo.author))
                                    .underline()
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                        } else {
                            Text(String(format: String(localized: "university_photo_by"), photo.author))
                        }
                        if let licenseUrl = URL(string: photo.licenseUrl) {
                            Link(destination: licenseUrl) {
                                Text(photo.license)
                                    .underline()
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                        } else {
                            Text(photo.license)
                        }
                        Text("university_photo_crop")
                            .font(.footnote)
                    }
                    .font(.subheadline)
                    .fixedSize(horizontal: false, vertical: true)
                } label: {
                    Text("university_photo_details")
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
            }
        } else {
            placeholder("university_photo_missing")
        }
    }

    private func placeholder(_ key: LocalizedStringKey) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14)
                .fill(.thinMaterial)
                .frame(height: 120)
            Text(key)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
        }
    }
}

struct UniversityProgramCard: View {
    let program: UniversityProgram

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(program.title)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text(levelLabel(program.level))
                .font(.caption.weight(.medium))
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(Color("AccentColor").opacity(0.12), in: Capsule())

            if let duration = program.duration, !duration.isEmpty {
                factLine("university_program_duration", value: duration)
            }
            if let language = program.language, !language.isEmpty {
                factLine("university_program_language", value: language)
            }
            if !program.summary.isEmpty {
                Text(program.summary)
                    .font(.subheadline)
            }

            ForEach(Array(program.intakes.enumerated()), id: \.offset) { _, intake in
                Divider()
                    .padding(.vertical, 4)
                UniversityIntakeView(intake: intake)
            }

            if let url = URL(string: program.sourceUrl) {
                Link(destination: url) {
                    Label("university_program_page", systemImage: "arrow.up.right")
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func factLine(_ key: LocalizedStringKey, value: String) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(key).font(.footnote)
                Text(value).font(.subheadline.weight(.medium))
            }
            .fixedSize(horizontal: true, vertical: false)

            VStack(alignment: .leading, spacing: 4) {
                Text(key).font(.footnote)
                Text(value).font(.subheadline.weight(.medium))
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }

    private func levelLabel(_ level: String) -> String {
        universityLevelLabel(level)
    }
}

struct UniversityIntakeView: View {
    let intake: UniversityIntake

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(intake.label)
                .font(.subheadline.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            Text(statusText)
                .font(.footnote.weight(.medium))

            if let start = startLine {
                Text(start)
                    .font(.footnote)
            }
            if let deadline = deadlineLine {
                Text(deadline)
                    .font(.footnote)
            }
            if !intake.note.isEmpty {
                Text(intake.note)
                    .font(.footnote)
            }
            if let url = URL(string: intake.sourceUrl) {
                Link(destination: url) {
                    Text("university_intake_source")
                        .underline()
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var statusText: LocalizedStringKey {
        switch universityIntakeDisplayStatus(intake) {
        case .closed: return "university_intake_status_closed"
        case .needsConfirmation: return "university_intake_status_needs_confirmation"
        case .open: return "university_intake_status_open"
        case .announced: return "university_intake_status_announced"
        case .unclear: return "university_intake_status_unclear"
        }
    }

    private var startLine: String? {
        if let startDate = intake.startDate,
           let label = CatalogDate.dayLabel(from: startDate, locale: AppLocale.current) {
            return String(format: String(localized: "university_intake_start"), label)
        }
        if let startMonth = intake.startMonth,
           let label = CatalogDate.monthLabel(from: startMonth, locale: AppLocale.current) {
            return String(format: String(localized: "university_intake_start"), label)
        }
        return nil
    }

    private var deadlineLine: String? {
        guard let deadline = intake.applicationDeadline,
              let label = CatalogDate.dayLabel(from: deadline, locale: AppLocale.current)
        else { return nil }
        if let time = intake.deadlineTime, let timezone = intake.timezone {
            return String(
                format: String(localized: "university_intake_deadline_with_time"),
                label, time, timezone
            )
        }
        return String(format: String(localized: "university_intake_deadline"), label)
    }
}
