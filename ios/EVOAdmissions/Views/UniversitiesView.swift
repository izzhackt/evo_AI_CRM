import SwiftUI

/// UI language of the bundle actually being displayed (ru or ky). Used for
/// data-driven labels (country names, dates) so they match the interface
/// language instead of an English device locale.
enum AppLocale {
    static var current: Locale {
        Locale(identifier: Bundle.main.preferredLocalizations.first ?? "ru")
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
                            NavigationLink(value: item.id) {
                                UniversityRow(item: item)
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

/// «Город, Страна» — country name localized to the interface language.
func universityPlaceLine(_ content: UniversityContent) -> String {
    let country = AppLocale.current.localizedString(forRegionCode: content.country)
        ?? content.country
    if let city = content.city, !city.isEmpty {
        return "\(city), \(country)"
    }
    return country
}
