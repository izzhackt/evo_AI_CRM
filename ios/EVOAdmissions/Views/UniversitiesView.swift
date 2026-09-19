import SwiftUI

/// UI language of the bundle actually being displayed (ru or ky). Used for
/// data-driven labels (country names, dates) so they match the interface
/// language instead of an English device locale.
enum AppLocale {
    static var current: Locale {
        Locale(identifier: Bundle.main.preferredLocalizations.first ?? "ru")
    }

    /// Отображается ли сейчас кыргызская локализация bundle'а. Управляет
    /// выбором RU/KY-полей ДВУЯЗЫЧНОГО контента (обучение, профессии), где
    /// перевод приходит данными, а не через String Catalog.
    static var isKyrgyz: Bool {
        Bundle.main.preferredLocalizations.first == "ky"
    }

    /// Пара RU/KY контентных строк → строка активного языка интерфейса.
    static func pick(ru: String, ky: String) -> String {
        isKyrgyz ? ky : ru
    }
}

@MainActor
final class UniversitiesViewModel: ObservableObject {
    @Published var items: [UniversityCatalogItem] = []
    @Published var nextOffset: Int?
    @Published var isLoading = false
    @Published var isLoadingMore = false
    @Published var errorMessage: String?
    @Published var loadMoreFailed = false

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    var hasMore: Bool { nextOffset != nil }

    func loadFirstPage() async {
        if isLoading { return }
        isLoading = true
        errorMessage = nil
        loadMoreFailed = false
        do {
            let page = try await service.studentUniversityCatalog(offset: 0)
            items = page.items
            nextOffset = page.nextOffset
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func loadNextPage() async {
        guard let offset = nextOffset, !isLoadingMore, !isLoading else { return }
        isLoadingMore = true
        loadMoreFailed = false
        do {
            let page = try await service.studentUniversityCatalog(offset: offset)
            // Публикация между страницами может сдвинуть offset и повторить
            // запись — дубль отбрасываем (та же логика, что у веб-карты).
            let known = Set(items.map(\.id))
            items.append(contentsOf: page.items.filter { !known.contains($0.id) })
            // Не доверяем nextOffset, который не двигается вперёд: иначе
            // возможен бесконечный цикл автоподгрузки.
            if let next = page.nextOffset, next <= offset {
                nextOffset = nil
            } else {
                nextOffset = page.nextOffset
            }
        } catch {
            loadMoreFailed = true
        }
        isLoadingMore = false
    }
}

struct UniversitiesView: View {
    @StateObject private var model = UniversitiesViewModel()
    @ObservedObject private var favorites = FavoritesStore.shared

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.items.isEmpty {
                    ProgressView()
                } else if let errorMessage = model.errorMessage, model.items.isEmpty {
                    VStack(spacing: 12) {
                        Text("universities_unavailable")
                            .font(.body)
                            .multilineTextAlignment(.center)
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button("retry_button") {
                            Task { await model.loadFirstPage() }
                        }
                        .buttonStyle(.bordered)
                    }
                    .padding(32)
                } else if model.items.isEmpty {
                    Text("universities_empty")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(32)
                } else {
                    List {
                        ForEach(model.items) { item in
                            // Сердечко (миграция 195): optimistic + честный
                            // откат через общий FavoritesStore.
                            HStack(spacing: 12) {
                                NavigationLink(value: item.id) {
                                    UniversityRow(item: item)
                                }
                                FavoriteHeartButton(institutionId: item.id, store: favorites)
                            }
                            .onAppear {
                                if item.id == model.items.last?.id {
                                    Task { await model.loadNextPage() }
                                }
                            }
                        }

                        if model.hasMore {
                            HStack {
                                Spacer()
                                if model.isLoadingMore {
                                    ProgressView()
                                } else {
                                    Button("universities_load_more") {
                                        Task { await model.loadNextPage() }
                                    }
                                    .buttonStyle(.bordered)
                                }
                                Spacer()
                            }
                            .listRowSeparator(.hidden)
                        }

                        if model.loadMoreFailed {
                            Text("universities_load_more_failed")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                                .listRowSeparator(.hidden)
                        }
                    }
                    .listStyle(.plain)
                    .refreshable { await model.loadFirstPage() }
                }
            }
            .navigationTitle("tab_universities")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    // Раздел «Избранное» (195) живёт внутри вкладки каталога.
                    NavigationLink {
                        FavoritesView()
                    } label: {
                        Label("favorites_title", systemImage: "heart")
                    }
                }
            }
            .navigationDestination(for: UUID.self) { institutionId in
                UniversityDetailView(
                    institutionId: institutionId,
                    initialItem: model.items.first(where: { $0.id == institutionId })
                )
            }
            .task {
                if model.items.isEmpty {
                    await model.loadFirstPage()
                }
                await favorites.loadIfNeeded()
            }
            .alert("favorite_error", isPresented: $favorites.toggleFailed) {
                Button("ok_button", role: .cancel) {}
            }
        }
    }
}

private struct UniversityRow: View {
    let item: UniversityCatalogItem

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(item.content.name)
                .font(.headline)
            Text(universityPlaceLine(item.content))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

/// Локализованная подпись уровня программы (151). Общая для карточки вуза и
/// таблицы сравнения избранного.
func universityLevelLabel(_ level: String) -> String {
    let key: String.LocalizationValue
    switch level {
    case "language": key = "university_level_language"
    case "foundation": key = "university_level_foundation"
    case "diploma": key = "university_level_diploma"
    case "bachelor": key = "university_level_bachelor"
    case "master": key = "university_level_master"
    case "doctorate": key = "university_level_doctorate"
    default: return level
    }
    return String(localized: key)
}

/// «Город, Страна» — country name localized to the interface language.
func universityPlaceLine(_ content: UniversityContent) -> String {
    let country = AppLocale.current.localizedString(forRegionCode: content.country)
        ?? content.country
    if let city = content.city, !city.isEmpty {
        return "\(city), \(country)"
    }
    return country
}
