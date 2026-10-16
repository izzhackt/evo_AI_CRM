import SwiftUI

/// Вкладка «Университеты» сборки 1.1 (университеты v2, план 7.4, решение
/// владельца Р2): сетка шести стран с фото и поиск по названию на первом
/// экране → страна (города или карта) → город → вуз. Все экраны каталога
/// читают один индекс 283 (`UniversityIndexStore`, копия на диске по
/// версии); страница вуза читает один `student_university_detail_v1`.
struct UniversityAtlasView: View {
    let organizationId: UUID

    @ObservedObject private var store = UniversityIndexStore.shared
    @ObservedObject private var favorites = FavoritesStore.shared
    @State private var query = ""
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("tab_universities")
                .searchable(
                    text: $query,
                    placement: .navigationBarDrawer(displayMode: .always),
                    prompt: Text("catalog_search_prompt")
                )
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        // «Избранное» (195) живёт внутри вкладки каталога.
                        NavigationLink {
                            FavoritesView()
                        } label: {
                            Label("favorites_title", systemImage: "heart")
                        }
                    }
                }
                .navigationDestination(for: AtlasRoute.self) { route in
                    switch route {
                    case .country(let code): CountryAtlasView(code: code)
                    case .city(let key): CityAtlasView(cityKey: key)
                    }
                }
                .navigationDestination(for: UUID.self) { institutionId in
                    UniversityDetailView(institutionId: institutionId, initialItem: nil)
                }
                .task {
                    async let index: Void = store.load(organizationId: organizationId)
                    async let saved: Void = favorites.loadIfNeeded()
                    _ = await (index, saved)
                }
                .alert("favorite_error", isPresented: $favorites.toggleFailed) {
                    Button("ok_button", role: .cancel) {}
                }
        }
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @ViewBuilder
    private var content: some View {
        if let index = store.index {
            if trimmedQuery.isEmpty {
                countries(index)
            } else {
                searchResults(index)
            }
        } else if store.phase == .failed {
            AtlasMessageView(title: "catalog_load_failed", message: "catalog_load_failed_hint", systemImage: "wifi.exclamationmark") {
                await store.refresh()
            }
        } else {
            skeleton
        }
    }

    private var columns: [GridItem] {
        // Крупный шрифт специальных возможностей: одна колонка, подписи
        // не обрезаются.
        let count = dynamicTypeSize.isAccessibilitySize ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: count)
    }

    private func countries(_ index: UniversityIndex) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if store.refreshFailed { AtlasStaleNotice() }
                LazyVGrid(columns: columns, alignment: .leading, spacing: 20) {
                    ForEach(index.countries) { country in
                        NavigationLink(value: AtlasRoute.country(country.code)) {
                            CountryAtlasCard(country: country)
                        }
                        .buttonStyle(.pressable)
                        .motionStagger(
                            index: MotionPolicy.staggerIndex(of: country, in: index.countries),
                            key: "atlas.country.\(country.code)"
                        )
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .refreshable { await store.refresh() }
    }

    private var skeleton: some View {
        ScrollView {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 20) {
                ForEach(0..<6, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: 8) {
                        RoundedRectangle(cornerRadius: AtlasStyle.cardRadius, style: .continuous)
                            .fill(AtlasStyle.placeholder)
                            .aspectRatio(4 / 3, contentMode: .fit)
                        RoundedRectangle(cornerRadius: 4).fill(AtlasStyle.placeholder).frame(width: 90, height: 16)
                        RoundedRectangle(cornerRadius: 4).fill(AtlasStyle.placeholder).frame(width: 130, height: 12)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("catalog_loading"))
    }

    @ViewBuilder
    private func searchResults(_ index: UniversityIndex) -> some View {
        let results = UniversityAtlasPolicy.search(trimmedQuery, in: index.universities)
        if results.isEmpty {
            AtlasMessageView(title: "catalog_search_empty", message: "catalog_search_empty_hint", systemImage: "magnifyingglass")
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Text(String(format: String(localized: "catalog_search_count"), locale: AppLocale.current, results.count))
                        .font(.footnote)
                        .foregroundStyle(AtlasStyle.secondaryText)
                        .padding(.bottom, 4)
                    ForEach(results) { university in
                        UniversityIndexRow(
                            university: university,
                            place: Self.placeLine(university, in: index),
                            favorites: favorites
                        )
                        if university.id != results.last?.id { Divider().padding(.leading, 76) }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            .scrollDismissesKeyboard(.immediately)
        }
    }

    /// «Ханчжоу · Китай» для строки поиска: вуз видно вместе со страной.
    static func placeLine(_ university: UniversityIndexEntry, in index: UniversityIndex) -> String? {
        let kyrgyz = AtlasText.kyrgyz
        let country = index.countries.first { $0.code == university.country }?.name.text(kyrgyz: kyrgyz)
        let city = UniversityAtlasPolicy.cityName(for: university, in: index, kyrgyz: kyrgyz)
        let parts = [city, country].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// Карточка страны: фото, название, «N университетов · M городов».
private struct CountryAtlasCard: View {
    let country: AtlasCountry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Group {
                if let photo = country.photo {
                    AtlasPhotoView(subject: .geography(photo), aspectRatio: 4 / 3)
                } else {
                    AtlasStyle.placeholder
                        .aspectRatio(4 / 3, contentMode: .fit)
                        .overlay {
                            Image(systemName: "globe.asia.australia")
                                .font(.title)
                                .foregroundStyle(AtlasStyle.secondaryText)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: AtlasStyle.cardRadius, style: .continuous))
                }
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(country.name.text(kyrgyz: AtlasText.kyrgyz))
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                stats
                    .font(.subheadline)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// «20 университетов · 11 городов» в одну строку, если помещается;
    /// иначе каждое число своей строкой, без переноса посреди фразы.
    @ViewBuilder
    private var stats: some View {
        if country.universityCount == 0 {
            Text(AtlasText.countryStats(country))
        } else {
            ViewThatFits(in: .horizontal) {
                Text(AtlasText.countryStats(country)).lineLimit(1)
                VStack(alignment: .leading, spacing: 0) {
                    Text(AtlasText.universities(country.universityCount))
                    Text(AtlasText.cities(country.cityCount))
                }
            }
        }
    }
}
