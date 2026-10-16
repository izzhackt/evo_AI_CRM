import Foundation

/// Индекс университетов v2 для всех экранов каталога (страны, города, карта,
/// поиск): один RPC на запуск и на pull-to-refresh, копия на диске по версии
/// (контракт 2.4). Показ сначала из копии, затем сверка версии с сервером;
/// `notModified` оставляет копию. Сбой обновления при живой копии честно
/// отмечается и копию не стирает; без копии это явная ошибка, а не пустой
/// каталог.
@MainActor
final class UniversityIndexStore: ObservableObject {
    static let shared = UniversityIndexStore()

    enum Phase: Equatable {
        case idle
        case loading
        case ready
        /// Индекса нет ни на диске, ни с сервера.
        case failed
    }

    @Published private(set) var index: UniversityIndex?
    @Published private(set) var phase: Phase = .idle
    /// Показана копия, а сверка с сервером не удалась.
    @Published private(set) var refreshFailed = false

    private let service: SupabaseService
    private let cache: UniversityIndexDiskCache
    private var organizationId: UUID?
    private var checkedThisLaunch = false
    private var inFlight: Task<Void, Never>?

    init(service: SupabaseService = .shared, cache: UniversityIndexDiskCache = .standard) {
        self.service = service
        self.cache = cache
    }

    /// Первый показ каталога: копия с диска, затем одна сверка за запуск.
    func load(organizationId: UUID) async {
        if self.organizationId != organizationId {
            inFlight?.cancel()
            inFlight = nil
            self.organizationId = organizationId
            index = cache.read(organizationId: organizationId)
            checkedThisLaunch = false
            refreshFailed = false
            phase = index == nil ? .idle : .ready
        }
        if checkedThisLaunch, inFlight == nil { return }
        await fetch()
    }

    /// Pull-to-refresh: сверка версии всегда.
    func refresh() async {
        await fetch()
    }

    private func fetch() async {
        if let inFlight {
            await inFlight.value
            return
        }
        guard let organizationId else { return }
        let task = Task { await self.performFetch(organizationId: organizationId) }
        inFlight = task
        await task.value
        // Смена организации во время запроса уже поставила свой запрос.
        if inFlight == task { inFlight = nil }
    }

    private func performFetch(organizationId: UUID) async {
        if index == nil { phase = .loading }
        let known = index?.version
        let cache = self.cache
        do {
            let data = try await service.studentUniversityIndexData(knownVersion: known)
            let response = try await Task.detached(priority: .userInitiated) {
                try UniversityIndexResponse.decode(data)
            }.value
            guard self.organizationId == organizationId, !Task.isCancelled else { return }
            switch response {
            case .notModified(let version):
                // notModified приходит только на совпавшую версию; иначе это
                // ошибка, а не повод оставить чужую копию.
                guard index?.version == version else { throw UniversityIndexStoreError.unexpectedNotModified }
            case .full(let fresh):
                index = fresh
                Task.detached(priority: .utility) {
                    try? cache.write(data, organizationId: organizationId)
                }
            }
            checkedThisLaunch = true
            refreshFailed = false
            phase = .ready
        } catch {
            guard self.organizationId == organizationId, !Task.isCancelled else { return }
            if index == nil {
                phase = .failed
            } else {
                refreshFailed = true
                phase = .ready
            }
        }
    }
}

enum UniversityIndexStoreError: Error {
    case unexpectedNotModified
}
