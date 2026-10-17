import Combine
import Foundation

/// Индекс университетов v2 для всех экранов каталога (страны, города, карта,
/// поиск): один RPC на запуск и на pull-to-refresh, копия на диске по версии
/// (контракт 2.4). Показ сначала из копии, затем сверка версии с сервером;
/// `notModified` оставляет копию. Сбой обновления при живой копии честно
/// отмечается и копию не стирает; без копии это явная ошибка, а не пустой
/// каталог.
///
/// Загрузка тела ответа передаётся функцией (`Fetch`), поэтому логика
/// хранилища проверяется hostless-тестами без Supabase SDK; боевое
/// хранилище `shared` собрано в `SupabaseService+UniversityAtlas.swift`.
@MainActor
final class UniversityIndexStore: ObservableObject {
    /// Тело ответа `student_university_index_v1(p_known_version)`.
    typealias Fetch = @Sendable (_ knownVersion: String?) async throws -> Data

    /// Почему индекса нет: от этого зависит подсказка на экране.
    enum Failure: Equatable {
        /// Сеть не ответила: «Проверьте интернет».
        case connection
        /// Ответ пришёл, но его нельзя показать (сервер отказал или обёртка
        /// ответа неверна, контракт 2.2a): сеть ни при чём, подсказка
        /// нейтральная.
        case unavailable
    }

    enum Phase: Equatable {
        case idle
        case loading
        case ready
        /// Индекса нет ни на диске, ни с сервера.
        case failed(Failure)
    }

    @Published private(set) var index: UniversityIndex?
    @Published private(set) var phase: Phase = .idle
    /// Показана копия, а сверка с сервером не удалась.
    @Published private(set) var refreshFailed = false

    private let fetchData: Fetch
    private let isForbidden: @Sendable (Error) -> Bool
    private let report: CatalogParseReporter
    private let cache: UniversityIndexDiskCache
    private var organizationId: UUID?
    private var checkedThisLaunch = false
    private var inFlight: Task<Void, Never>?
    /// Запись и удаление копии идут по одной очереди: удаление после 42501
    /// не обгонит запись, поставленную раньше, и копия не вернётся на диск.
    private let diskQueue = DispatchQueue(label: "com.evoadmissions.university-index.disk", qos: .utility)

    /// - Parameter isForbidden: отказ сервера в доступе (42501). Копия
    ///   организации тогда снимается с экрана и с диска: веб тоже отдаёт
    ///   индекс только после удачного вызова.
    /// - Parameter report: строка журнала на каждую отброшенную или
    ///   заменённую часть ответа сервера (контракт 2.2a).
    init(
        cache: UniversityIndexDiskCache = .standard,
        isForbidden: @escaping @Sendable (Error) -> Bool = { _ in false },
        report: @escaping CatalogParseReporter = CatalogParseLog.reporter(rpc: CatalogParseLog.indexRpc),
        fetch: @escaping Fetch
    ) {
        self.cache = cache
        self.isForbidden = isForbidden
        self.report = report
        self.fetchData = fetch
    }

    /// Первый показ каталога: копия с диска, затем одна сверка за запуск.
    func load(organizationId: UUID) async {
        if self.organizationId != organizationId {
            inFlight?.cancel()
            inFlight = nil
            self.organizationId = organizationId
            index = nil
            checkedThisLaunch = false
            refreshFailed = false
            phase = .idle
            // Копия (в production около 150 КБ) читается и разбирается вне
            // главного потока.
            let cache = self.cache
            let saved = await Task.detached(priority: .userInitiated) {
                cache.read(organizationId: organizationId)
            }.value
            guard self.organizationId == organizationId else { return }
            if index == nil, let saved {
                index = saved
                phase = .ready
            }
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
        let report = self.report
        do {
            let data = try await fetchData(known)
            let response = try await Task.detached(priority: .userInitiated) {
                try UniversityIndexResponse.decode(data, report: report)
            }.value
            guard self.organizationId == organizationId, !Task.isCancelled else { return }
            switch response {
            case .notModified(let version):
                // notModified приходит только на совпавшую версию; иначе это
                // ошибка, а не повод оставить чужую копию.
                guard index?.version == version else { throw UniversityIndexStoreError.unexpectedNotModified }
            case .full(let fresh):
                index = fresh
                diskQueue.async {
                    try? cache.write(data, organizationId: organizationId)
                }
            }
            checkedThisLaunch = true
            refreshFailed = false
            phase = .ready
        } catch {
            guard self.organizationId == organizationId, !Task.isCancelled else { return }
            if isForbidden(error) {
                index = nil
                refreshFailed = false
                // Синхронно: после возврата копии на диске точно нет.
                diskQueue.sync {
                    cache.remove(organizationId: organizationId)
                }
                phase = .failed(.unavailable)
            } else if index == nil {
                phase = .failed(error is URLError ? .connection : .unavailable)
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
