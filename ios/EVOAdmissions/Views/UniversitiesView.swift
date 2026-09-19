import SwiftUI

@MainActor
final class UniversitiesViewModel: ObservableObject {
    @Published var items: [UniversityCatalogItem] = []
    @Published var hasMore = false
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func loadFirstPage() async {
        isLoading = true
        errorMessage = nil
        do {
            let page = try await service.studentUniversityCatalog(offset: 0)
            items = page.items
            hasMore = page.nextOffset != nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

struct UniversitiesView: View {
    @StateObject private var model = UniversitiesViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.items.isEmpty {
                    ProgressView()
                } else if let errorMessage = model.errorMessage {
                    VStack(spacing: 12) {
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
                } else {
                    List {
                        ForEach(model.items) { item in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.content.name)
                                    .font(.headline)
                                Text(cityCountry(item.content))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .padding(.vertical, 4)
                        }

                        if model.hasMore {
                            Text("universities_more_note")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("tab_universities")
            .task { await model.loadFirstPage() }
        }
    }

    private func cityCountry(_ content: UniversityContent) -> String {
        if let city = content.city, !city.isEmpty {
            return "\(city), \(content.country)"
        }
        return content.country
    }
}
