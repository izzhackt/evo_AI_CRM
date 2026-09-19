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

/// Список⇄карта — те же два представления одного набора и одних фильтров,
/// что на вебе (Catalog.tsx `UniversitiesView`, дизайн-контракт: «веб и
/// iPhone — одни возможности»).
enum UniversitiesViewMode: String, CaseIterable, Identifiable {
    case list
    case map

    var id: String { rawValue }
}

@MainActor
final class UniversitiesViewModel: ObservableObject {
    @Published var items: [UniversityCatalogItem] = []
    @Published var nextOffset: Int?
    @Published var isLoading = false
    @Published var isLoadingMore = false
    @Published var errorMessage: String?
    @Published var loadMoreFailed = false

    /// Текст в системном поле поиска; в фильтры попадает через debounce.
    @Published var searchText = ""
    @Published private(set) var filters = UniversityCatalogFilters()
    @Published var viewMode: UniversitiesViewMode = .list

    // Карта: полный отфильтрованный набор (не страница списка) — как на
    // вебе (university-catalog-reader.ts). Сбой карты — явное состояние.
    @Published var mapPins: [UniversityMapPin] = []
    @Published var mapMissing = 0
    @Published var isMapLoading = false
    @Published var mapFailed = false
    private var mapLoadedFilters: UniversityCatalogFilters?

    private let service: SupabaseService
    private var searchDebounce: Task<Void, Never>?
    // Review #912 (medium): голые guard'ы isLoading/isMapLoading молча
    // дропали перезагрузку во время полёта, и завершение публиковало
    // результат СТАРЫХ фильтров. Затворы с поколением делают смену фильтров
    // честной; семантика и выбор «generation counter vs Task-cancellation» —
    // в SingleFlightReloadGate (юниты: SingleFlightReloadGateTests).
    private let listReload = SingleFlightReloadGate()
    private let mapReload = SingleFlightReloadGate()

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    var hasMore: Bool { nextOffset != nil }

    /// Полный ISO-список стран веб-фильтра, локализованный и отсортированный
    /// коллацией активного языка интерфейса — как веб (Catalog.tsx:67-70).
    lazy var countryOptions: [(code: String, label: String)] = {
        let locale = AppLocale.current
        return UniversityCatalogFilterPolicy.countries
            .map { code in
                (code: code, label: locale.localizedString(forRegionCode: code) ?? code)
            }
            .sorted { $0.label.compare($1.label, locale: locale) == .orderedAscending }
    }()

    func loadFirstPage() async {
        // Полёт уже идёт — НЕ молчаливый дроп (review #912): invalidate()
        // из applyFilterChange уже сдвинул поколение, и затвор перезапустит
        // действующий полёт с актуальными фильтрами сам.
        if listReload.isRunning { return }
        isLoading = true
        errorMessage = nil
        loadMoreFailed = false
        await listReload.run { [service] in
            // Фильтры перечитываются при КАЖДОЙ попытке затвора — рестарт
            // после смены поколения работает уже с новыми значениями.
            let requested = filters
            do {
                let page = try await service.studentUniversityCatalog(filters: requested, offset: 0)
                return {
                    self.items = page.items
                    self.nextOffset = page.nextOffset
                    self.errorMessage = nil
                }
            } catch {
                return { self.errorMessage = error.localizedDescription }
            }
        }
        isLoading = false
    }

    func loadNextPage() async {
        guard let offset = nextOffset, !isLoadingMore, !isLoading, !listReload.isRunning else { return }
        isLoadingMore = true
        loadMoreFailed = false
        // Review #912: страница, запрошенная до смены фильтров, не должна
        // доклеиваться к списку НОВЫХ фильтров — устаревший ответ (и его
        // ошибка) отбрасывается; первую страницу перегрузит applyFilterChange.
        let requestedGeneration = listReload.generation
        do {
            let page = try await service.studentUniversityCatalog(filters: filters, offset: offset)
            guard requestedGeneration == listReload.generation else {
                isLoadingMore = false
                return
            }
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
            guard requestedGeneration == listReload.generation else {
                isLoadingMore = false
                return
            }
            loadMoreFailed = true
        }
        isLoadingMore = false
    }

    // MARK: - Filters

    /// Debounce 300 мс: фильтр `q` применяется после паузы ввода, а не на
    /// каждый символ (сетевой RPC на каждый keystroke был бы нечестной
    /// нагрузкой и мерцанием списка).
    func searchTextChanged() {
        searchDebounce?.cancel()
        let clamped = UniversityCatalogFilterPolicy.clampQuery(searchText)
        searchDebounce = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled, let self, self.filters.query != clamped else { return }
            self.filters.query = clamped
            await self.applyFilterChange()
        }
    }

    func setCountry(_ code: String) async {
        guard filters.country != code else { return }
        filters.country = code
        await applyFilterChange()
    }

    func setLevel(_ level: String) async {
        guard filters.level != level else { return }
        filters.level = level
        await applyFilterChange()
    }

    func resetFilters() async {
        searchDebounce?.cancel()
        searchText = ""
        guard filters.isActive else { return }
        filters = UniversityCatalogFilters()
        await applyFilterChange()
    }

    private func applyFilterChange() async {
        // Каждая смена фильтров открывает новое поколение (review #912):
        // результат любого полёта со старыми фильтрами будет отброшен, а
        // сам полёт перезапущен затвором с актуальными значениями.
        listReload.invalidate()
        mapReload.invalidate()
        mapLoadedFilters = nil
        if viewMode == .map {
            async let list: Void = loadFirstPage()
            async let map: Void = loadMap()
            _ = await (list, map)
        } else {
            await loadFirstPage()
        }
    }

    // MARK: - Map

    /// Вызывается при показе карты: перезагружает набор только когда фильтры
    /// изменились или прошлая загрузка упала.
    func loadMapIfNeeded() async {
        if mapLoadedFilters == filters, !mapFailed { return }
        await loadMap()
    }

    func loadMap() async {
        // Полёт уже идёт — НЕ молчаливый дроп (review #912): при сдвиге
        // поколения затвор отбросит результат старых фильтров и перезапустит
        // сбор с актуальными (смена A→B в середине до 12 RPC не оставит
        // пины A под чипами B).
        if mapReload.isRunning { return }
        isMapLoading = true
        mapFailed = false
        await mapReload.run { [service] in
            // Фильтры перечитываются при КАЖДОЙ попытке затвора.
            let requested = filters
            do {
                let complete = try await UniversityMapPolicy.collectComplete { offset in
                    try await service.studentUniversityCatalog(filters: requested, offset: offset)
                }
                let selection = UniversityMapPolicy.pins(
                    for: complete,
                    geo: UniversityGeoLibrary.shared
                )
                return {
                    self.mapPins = selection.pins
                    self.mapMissing = selection.missing
                    self.mapLoadedFilters = requested
                    self.mapFailed = false
                }
            } catch {
                return { self.mapFailed = true }
            }
        }
        isMapLoading = false
    }

    /// Карточка для перехода с карты или из списка: пин может указывать на
    /// вуз, которого нет на текущей странице списка — тогда initialItem
    /// честно nil и карточка грузится сама.
    func knownItem(for institutionId: UUID) -> UniversityCatalogItem? {
        items.first(where: { $0.id == institutionId })
    }
}

struct UniversitiesView: View {
    @StateObject private var model = UniversitiesViewModel()
    @ObservedObject private var favorites = FavoritesStore.shared

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                filterBar
                content
            }
            .searchable(
                text: $model.searchText,
                placement: .navigationBarDrawer(displayMode: .automatic),
                prompt: Text("universities_search_placeholder")
            )
            .onChange(of: model.searchText) {
                model.searchTextChanged()
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
                    initialItem: model.knownItem(for: institutionId)
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

    /// Список⇄карта + фильтры «страна/уровень» — общие для обоих
    /// представлений, как на вебе (один `q/country/level` в обоих href).
    private var filterBar: some View {
        VStack(spacing: 8) {
            Picker("universities_view_toggle", selection: $model.viewMode) {
                Text("universities_view_list").tag(UniversitiesViewMode.list)
                Text("universities_view_map").tag(UniversitiesViewMode.map)
            }
            .pickerStyle(.segmented)
            .accessibilityLabel(Text("universities_view_toggle"))

            HStack(spacing: 8) {
                Menu {
                    Picker("universities_country", selection: countryBinding) {
                        Text("universities_all_countries").tag("")
                        ForEach(model.countryOptions, id: \.code) { option in
                            Text(option.label).tag(option.code)
                        }
                    }
                } label: {
                    filterChip(
                        title: model.filters.country.isEmpty
                            ? String(localized: "universities_all_countries")
                            : countryLabel(model.filters.country),
                        active: !model.filters.country.isEmpty
                    )
                }
                .accessibilityLabel(Text("universities_country"))

                Menu {
                    Picker("universities_level", selection: levelBinding) {
                        Text("universities_all_levels").tag("")
                        ForEach(UniversityCatalogFilterPolicy.levels, id: \.self) { level in
                            Text(universityLevelLabel(level)).tag(level)
                        }
                    }
                } label: {
                    filterChip(
                        title: model.filters.level.isEmpty
                            ? String(localized: "universities_all_levels")
                            : universityLevelLabel(model.filters.level),
                        active: !model.filters.level.isEmpty
                    )
                }
                .accessibilityLabel(Text("universities_level"))

                Spacer()

                if model.filters.isActive {
                    Button("universities_reset_filters") {
                        Task { await model.resetFilters() }
                    }
                    .font(.footnote)
                }
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }

    private func filterChip(title: String, active: Bool) -> some View {
        HStack(spacing: 4) {
            Text(title)
                .lineLimit(1)
            Image(systemName: "chevron.down")
                .imageScale(.small)
        }
        .font(.subheadline)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule().fill(active ? Color.accentColor.opacity(0.15) : Color(.secondarySystemBackground))
        )
    }

    private var countryBinding: Binding<String> {
        Binding(
            get: { model.filters.country },
            set: { code in Task { await model.setCountry(code) } }
        )
    }

    private var levelBinding: Binding<String> {
        Binding(
            get: { model.filters.level },
            set: { level in Task { await model.setLevel(level) } }
        )
    }

    private func countryLabel(_ code: String) -> String {
        AppLocale.current.localizedString(forRegionCode: code) ?? code
    }

    @ViewBuilder
    private var content: some View {
        switch model.viewMode {
        case .list: listContent
        case .map:
            UniversitiesMapContainer(model: model)
        }
    }

    @ViewBuilder
    private var listContent: some View {
        if model.isLoading && model.items.isEmpty {
            Spacer()
            ProgressView()
            Spacer()
        } else if let errorMessage = model.errorMessage, model.items.isEmpty {
            Spacer()
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
            Spacer()
        } else if model.items.isEmpty {
            Spacer()
            if model.filters.isActive {
                // Честное пустое состояние ПОД ФИЛЬТРАМИ — те же строки, что
                // веб emptyTitle/emptyBody (Catalog.tsx:225-231).
                VStack(spacing: 12) {
                    Text("universities_filtered_empty_title")
                        .font(.headline)
                        .multilineTextAlignment(.center)
                    Text("universities_filtered_empty_body")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("universities_reset_filters") {
                        Task { await model.resetFilters() }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(32)
            } else {
                Text("universities_empty")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(32)
            }
            Spacer()
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
        // A11y-проход 9b: строка читается VoiceOver одним элементом
        // («название, город, страна»), а не двумя отдельными строками.
        .accessibilityElement(children: .combine)
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
