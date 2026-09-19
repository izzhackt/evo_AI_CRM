import Foundation

/// Общее состояние избранного (миграция 195) для сердечек в списке, карточке
/// и разделе «Избранное». Optimistic-переключение с ЧЕСТНЫМ откатом: локальное
/// состояние меняется сразу, затем сверяется с фактическим receipt
/// `set_university_favorite_v1`; ошибка сети возвращает прежнее состояние и
/// поднимает флаг для видимого сообщения — молча «как будто сохранилось» не
/// бывает.
@MainActor
final class FavoritesStore: ObservableObject {
    static let shared = FavoritesStore()

    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed
    }

    /// Текущее известное множество избранных вузов (id институций).
    @Published private(set) var favoriteIds: Set<UUID> = []
    /// Собственные записи в серверном порядке (свежие первыми, 195:109-110).
    @Published private(set) var favorites: [UniversityFavorite] = []
    @Published private(set) var loadState: LoadState = .idle
    /// Транзиентный флаг неудавшегося переключения — представление
    /// показывает alert и сбрасывает его.
    @Published var toggleFailed = false

    private let service: SupabaseService
    private var togglesInFlight: Set<UUID> = []

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func isFavorite(_ institutionId: UUID) -> Bool {
        favoriteIds.contains(institutionId)
    }

    func loadIfNeeded() async {
        if loadState == .loaded || loadState == .loading { return }
        await refresh()
    }

    func refresh() async {
        if loadState == .loading { return }
        loadState = .loading
        do {
            let rows = try await service.studentUniversityFavorites()
            favorites = rows
            favoriteIds = Set(rows.map(\.institutionId))
            loadState = .loaded
        } catch {
            loadState = .failed
        }
    }

    /// Optimistic toggle. Возвращает фактическое состояние после сверки с
    /// сервером (nil — запрос не удался и состояние откатано).
    @discardableResult
    func toggle(_ institutionId: UUID) async -> Bool? {
        // Повторное нажатие, пока запрос в полёте, игнорируется — состояние
        // на экране уже целевое, а RPC идемпотентна по построению.
        if togglesInFlight.contains(institutionId) {
            return favoriteIds.contains(institutionId)
        }
        togglesInFlight.insert(institutionId)
        defer { togglesInFlight.remove(institutionId) }

        let target = !favoriteIds.contains(institutionId)
        apply(institutionId: institutionId, favored: target)
        do {
            let receipt = try await service.setUniversityFavorite(
                institutionId: institutionId,
                favored: target
            )
            // Receipt несёт фактическое состояние — оно и является истиной.
            apply(institutionId: institutionId, favored: receipt.favored)
            return receipt.favored
        } catch {
            // Честный откат + видимый сигнал; ничего не «досохраняется» молча.
            apply(institutionId: institutionId, favored: !target)
            toggleFailed = true
            return nil
        }
    }

    /// Сброс на выходе из аккаунта: избранное — личные данные ученика.
    func clear() {
        favoriteIds = []
        favorites = []
        loadState = .idle
        toggleFailed = false
    }

    private func apply(institutionId: UUID, favored: Bool) {
        if favored {
            if favoriteIds.insert(institutionId).inserted {
                // Локальная вставка в начало зеркалит серверный порядок
                // «свежие первыми»; точный createdAt придёт при refresh().
                favorites.insert(
                    UniversityFavorite(institutionId: institutionId, createdAt: ""),
                    at: 0
                )
            }
        } else {
            favoriteIds.remove(institutionId)
            favorites.removeAll { $0.institutionId == institutionId }
        }
    }
}
