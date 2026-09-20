import SwiftUI

/// Сердечко избранного (миграция 195): optimistic-переключение через общий
/// `FavoritesStore` с честным откатом при ошибке. Используется в строках
/// списка вузов, в карточке вуза и в разделе «Избранное».
struct FavoriteHeartButton: View {
    let institutionId: UUID
    @ObservedObject var store: FavoritesStore

    var body: some View {
        let favored = store.isFavorite(institutionId)
        Button {
            Task { await store.toggle(institutionId) }
        } label: {
            Image(systemName: favored ? "heart.fill" : "heart")
                .foregroundStyle(favored ? Color("AccentColor") : Color.secondary)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(favored ? Text("favorite_remove") : Text("favorite_add"))
    }
}

/// Раздел «Избранное» (195, план §6): сохранённые вузы (собственный список +
/// batch-чтение карточек by_ids) и сравнение фактических свойств простой
/// таблицей. Никаких рейтингов и «шансов поступления» (план §14).
@MainActor
final class FavoritesViewModel: ObservableObject {
    @Published var items: [UniversityCatalogItem] = []
    @Published var isLoading = false
    @Published var loadFailed = false

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    /// Порядок раздела — серверный порядок избранного (свежие первыми).
    func load(store: FavoritesStore) async {
        if isLoading { return }
        isLoading = true
        loadFailed = false
        await store.refresh()
        guard store.loadState == .loaded else {
            loadFailed = true
            isLoading = false
            return
        }
        let orderedIds = store.favorites.map(\.institutionId)
        do {
            // Потолок by_ids — 30 id за вызов (195:129): читаем кусками.
            var byId: [UUID: UniversityCatalogItem] = [:]
            var offset = 0
            while offset < orderedIds.count {
                let chunk = Array(orderedIds[offset..<min(offset + 30, orderedIds.count)])
                let page = try await service.studentUniversityCatalogByIds(institutionIds: chunk)
                for item in page.items {
                    byId[item.id] = item
                }
                offset += 30
            }
            items = orderedIds.compactMap { byId[$0] }
        } catch {
            loadFailed = true
        }
        isLoading = false
    }
}

struct FavoritesView: View {
    @StateObject private var model = FavoritesViewModel()
    @ObservedObject private var store = FavoritesStore.shared
    @State private var compareSelection: Set<UUID> = []
    @State private var showsComparison = false

    /// Видимые строки: пересечение загруженных карточек с текущим множеством
    /// избранного, чтобы optimistic-снятие сердечка сразу убирало строку.
    private var visibleItems: [UniversityCatalogItem] {
        model.items.filter { store.favoriteIds.contains($0.id) }
    }

    private var comparedItems: [UniversityCatalogItem] {
        visibleItems.filter { compareSelection.contains($0.id) }
    }

    var body: some View {
        Group {
            if model.isLoading && model.items.isEmpty {
                ProgressView()
            } else if model.loadFailed && model.items.isEmpty {
                VStack(spacing: 12) {
                    Text("favorites_unavailable")
                        .font(.body)
                        .multilineTextAlignment(.center)
                    Button("retry_button") {
                        Task { await model.load(store: store) }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(32)
            } else if visibleItems.isEmpty {
                VStack(spacing: 8) {
                    Text("favorites_empty_title")
                        .font(.headline)
                    Text("favorites_empty_body")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(32)
            } else {
                favoritesList
            }
        }
        .navigationTitle("favorites_title")
        .task { await model.load(store: store) }
        .alert("favorite_error", isPresented: $store.toggleFailed) {
            Button("ok_button", role: .cancel) {}
        }
        .sheet(isPresented: $showsComparison) {
            FavoritesComparisonView(items: comparedItems)
        }
    }

    private var favoritesList: some View {
        List {
            Section {
                ForEach(visibleItems) { item in
                    HStack(spacing: 12) {
                        Button {
                            toggleCompare(item.id)
                        } label: {
                            Image(systemName: compareSelection.contains(item.id)
                                ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(compareSelection.contains(item.id)
                                    ? Color("AccentColor") : Color.secondary)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(Text(String(
                            format: String(localized: "favorites_compare_select"),
                            item.content.name
                        )))
                        // A11y (9b): выбранность для сравнения — не только
                        // цвет/иконка.
                        .accessibilityAddTraits(
                            compareSelection.contains(item.id) ? [.isSelected] : []
                        )

                        NavigationLink(value: item.id) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.content.name)
                                    .font(.headline)
                                Text(universityPlaceLine(item.content))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        FavoriteHeartButton(institutionId: item.id, store: store)
                    }
                    .padding(.vertical, 2)
                }
            } header: {
                Text(String(
                    format: String(localized: "favorites_saved_count"),
                    visibleItems.count
                ))
            } footer: {
                if model.loadFailed {
                    // Часть карточек могла не догрузиться — честно говорим.
                    Text("favorites_unavailable")
                }
            }

            Section {
                if comparedItems.count >= 2 {
                    Button("favorites_compare_open") {
                        showsComparison = true
                    }
                } else {
                    Text("favorites_compare_hint")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("favorites_compare_heading")
            }
        }
        .refreshable { await model.load(store: store) }
        .navigationDestination(for: UUID.self) { institutionId in
            UniversityDetailView(
                institutionId: institutionId,
                initialItem: model.items.first(where: { $0.id == institutionId })
            )
        }
    }

    private func toggleCompare(_ id: UUID) {
        if compareSelection.contains(id) {
            compareSelection.remove(id)
        } else if comparedItems.count < 3 {
            // Простой таблице фактов на экране телефона хватает трёх колонок.
            compareSelection.insert(id)
        }
    }
}

/// Сравнение — простая таблица фактов из опубликованных карточек: страна и
/// город, уровни программ, число программ, ближайший набор. Только факты,
/// без оценок.
struct FavoritesComparisonView: View {
    let items: [UniversityCatalogItem]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView([.vertical, .horizontal]) {
                Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 12) {
                    GridRow {
                        Text("favorites_compare_property")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ForEach(items) { item in
                            Text(item.content.name)
                                .font(.subheadline.weight(.semibold))
                                .frame(width: 140, alignment: .leading)
                        }
                    }
                    Divider()
                    factRow("favorites_compare_country") { item in
                        universityPlaceLine(item.content)
                    }
                    factRow("favorites_compare_levels") { item in
                        levelsLine(item.content)
                    }
                    factRow("favorites_compare_programs") { item in
                        String(item.content.programs.count)
                    }
                    factRow("favorites_compare_intake") { item in
                        nearestIntakeLine(item.content) ?? "—"
                    }
                }
                .padding(20)
            }
            .navigationTitle("favorites_compare_heading")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("close_button") { dismiss() }
                }
            }
        }
    }

    private func factRow(
        _ key: LocalizedStringKey,
        value: @escaping (UniversityCatalogItem) -> String
    ) -> some View {
        GridRow(alignment: .top) {
            Text(key)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 90, alignment: .leading)
            ForEach(items) { item in
                Text(value(item))
                    .font(.footnote)
                    .frame(width: 140, alignment: .leading)
            }
        }
    }

    private func levelsLine(_ content: UniversityContent) -> String {
        let order = ["language", "foundation", "diploma", "bachelor", "master", "doctorate"]
        let present = Set(content.programs.map(\.level))
        let labels = order.filter(present.contains).map(universityLevelLabel)
        return labels.isEmpty ? "—" : labels.joined(separator: ", ")
    }

    /// Ближайший старт среди интейков, которые сейчас читаются как open или
    /// announced (та же деталь честности, что в карточке: прошедший дедлайн —
    /// closed). Только факт даты, без прогнозов.
    private func nearestIntakeLine(_ content: UniversityContent) -> String? {
        var candidates: [(sortKey: String, label: String)] = []
        for program in content.programs {
            for intake in program.intakes {
                let status = universityIntakeDisplayStatus(intake)
                guard status == .open || status == .announced else { continue }
                if let day = intake.startDate,
                   let label = CatalogDate.dayLabel(from: day, locale: AppLocale.current) {
                    candidates.append((day, label))
                } else if let month = intake.startMonth,
                          let label = CatalogDate.monthLabel(from: month, locale: AppLocale.current) {
                    candidates.append((month, label))
                }
            }
        }
        return candidates.min(by: { $0.sortKey < $1.sortKey })?.label
    }
}
