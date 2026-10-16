import XCTest

/// Логика `UniversityIndexStore` (контракт 2.4) на реальных ответах демо:
/// показ из копии, одна сверка за запуск, `notModified` с той же и с чужой
/// версией, сбой с копией и без неё, отказ 42501, смена организации посреди
/// запроса. Загрузку тела подменяет сценарий, сети нет.
@MainActor
final class UniversityIndexStoreTests: XCTestCase {
    private var directory: URL!
    private var cache: UniversityIndexDiskCache!
    private let organization = UUID()
    private var fullBody: Data!
    private var fullIndex: UniversityIndex!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent("atlas-store-\(UUID().uuidString)")
        cache = UniversityIndexDiskCache(directory: directory)
        fullBody = try AtlasFixtures.data(AtlasFixtures.index)
        guard case .full(let index) = try UniversityIndexResponse.decode(fullBody) else { return XCTFail("Expected a full index") }
        fullIndex = index
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    /// Ответы по порядку вызовов; запоминает присланную версию.
    final class Script: @unchecked Sendable {
        enum Step {
            case body(Data)
            case failure(Error)
            /// Ждать `release()`, затем отдать тело.
            case gated(Data)
        }

        private let lock = NSLock()
        private var steps: [Step]
        private(set) var versions: [String?] = []
        private var gate: CheckedContinuation<Void, Never>?
        private var released = false
        let started = XCTestExpectation(description: "gated request started")

        init(_ steps: [Step]) { self.steps = steps }

        var calls: Int { lock.withLock { versions.count } }

        func release() {
            let continuation: CheckedContinuation<Void, Never>? = lock.withLock {
                released = true
                defer { gate = nil }
                return gate
            }
            continuation?.resume()
        }

        func fetch(_ version: String?) async throws -> Data {
            let step: Step = lock.withLock {
                versions.append(version)
                return steps.isEmpty ? .failure(URLError(.badServerResponse)) : steps.removeFirst()
            }
            switch step {
            case .body(let data):
                return data
            case .failure(let error):
                throw error
            case .gated(let data):
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    let resumeNow: Bool = lock.withLock {
                        if released { return true }
                        gate = continuation
                        return false
                    }
                    started.fulfill()
                    if resumeNow { continuation.resume() }
                }
                return data
            }
        }
    }

    struct Forbidden: Error {}

    private func store(_ script: Script) -> UniversityIndexStore {
        UniversityIndexStore(cache: cache, isForbidden: { $0 is Forbidden }, fetch: { try await script.fetch($0) })
    }

    private func notModified(_ version: String) -> Data {
        Data(#"{"notModified":true,"version":"\#(version)"}"#.utf8)
    }

    private func waitForCopy(timeout: TimeInterval = 5) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while cache.read(organizationId: organization) == nil, Date() < deadline {
            try await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    func testFirstLaunchWithoutCopyFetchesWithoutVersionAndSavesTheBody() async throws {
        let script = Script([.body(fullBody)])
        let store = store(script)
        await store.load(organizationId: organization)
        XCTAssertEqual(script.versions, [nil])
        XCTAssertEqual(store.index, fullIndex)
        XCTAssertEqual(store.phase, .ready)
        XCTAssertFalse(store.refreshFailed)
        try await waitForCopy()
        XCTAssertEqual(cache.read(organizationId: organization), fullIndex)
    }

    /// Одна неверная карточка (контракт 2.2a): каталог показан без неё, а не
    /// «не удалось загрузить»; хранилище пишет строку журнала через свой
    /// `report`, копия на диске это то же тело ответа.
    func testBrokenCityDegradesAloneAndIsReported() async throws {
        let body = try AtlasFixtures.mutated(AtlasFixtures.index) { $0.update(["cities", 0, "photo"]) { $0["author"] = "Diana\u{00A0}" } }
        let log = CatalogIssueLog()
        let script = Script([.body(body)])
        let store = UniversityIndexStore(cache: cache, isForbidden: { $0 is Forbidden }, report: log.report, fetch: { try await script.fetch($0) })
        await store.load(organizationId: organization)
        XCTAssertEqual(store.phase, .ready)
        XCTAssertEqual(store.index?.cities.count, 18)
        XCTAssertEqual(store.index?.universities.count, 29)
        XCTAssertEqual(log.issues.first, CatalogParseIssue(.city, "shanghai", "photo"))
        XCTAssertEqual(log.issues.last, CatalogParseIssue(.country, "CN", "count"))
        try await waitForCopy()
        XCTAssertEqual(cache.read(organizationId: organization), store.index)
    }

    func testCopyIsShownFirstAndCheckedOncePerLaunch() async throws {
        try cache.write(fullBody, organizationId: organization)
        let script = Script([.body(notModified(fullIndex.version)), .body(notModified(fullIndex.version))])
        let store = store(script)
        await store.load(organizationId: organization)
        // Сверка ушла с версией копии; notModified оставил копию.
        XCTAssertEqual(script.versions, [fullIndex.version])
        XCTAssertEqual(store.index, fullIndex)
        XCTAssertEqual(store.phase, .ready)
        // Повторный показ каталога в том же запуске сервер не спрашивает.
        await store.load(organizationId: organization)
        XCTAssertEqual(script.calls, 1)
        // Pull-to-refresh спрашивает всегда.
        await store.refresh()
        XCTAssertEqual(script.calls, 2)
        XCTAssertEqual(store.index, fullIndex)
    }

    func testNotModifiedForAnotherVersionKeepsTheCopyButMarksTheRefreshFailed() async throws {
        try cache.write(fullBody, organizationId: organization)
        let script = Script([.body(notModified("g1.other")), .body(notModified(fullIndex.version))])
        let store = store(script)
        await store.load(organizationId: organization)
        XCTAssertEqual(store.index, fullIndex)
        XCTAssertTrue(store.refreshFailed)
        XCTAssertEqual(store.phase, .ready)
        // Сверка не удалась: следующий показ спрашивает снова.
        await store.load(organizationId: organization)
        XCTAssertEqual(script.calls, 2)
        XCTAssertFalse(store.refreshFailed)
    }

    func testFailureWithCopyKeepsTheCopy() async throws {
        try cache.write(fullBody, organizationId: organization)
        let store = store(Script([.failure(URLError(.notConnectedToInternet))]))
        await store.load(organizationId: organization)
        XCTAssertEqual(store.index, fullIndex)
        XCTAssertTrue(store.refreshFailed)
        XCTAssertEqual(store.phase, .ready)
        XCTAssertNotNil(cache.read(organizationId: organization))
    }

    func testFailureWithoutCopyNamesTheReason() async throws {
        let offline = store(Script([.failure(URLError(.notConnectedToInternet))]))
        await offline.load(organizationId: organization)
        XCTAssertNil(offline.index)
        XCTAssertEqual(offline.phase, .failed(.connection))

        // Ответ пришёл, но не прошёл разбор: сеть ни при чём.
        let broken = try AtlasFixtures.mutated(AtlasFixtures.index) { $0["extra"] = true }
        let drift = store(Script([.body(broken)]))
        await drift.load(organizationId: organization)
        XCTAssertNil(drift.index)
        XCTAssertEqual(drift.phase, .failed(.unavailable))
    }

    func testForbiddenRemovesTheCopy() async throws {
        try cache.write(fullBody, organizationId: organization)
        let store = store(Script([.failure(Forbidden())]))
        await store.load(organizationId: organization)
        XCTAssertNil(store.index)
        XCTAssertFalse(store.refreshFailed)
        XCTAssertEqual(store.phase, .failed(.unavailable))
        XCTAssertNil(cache.read(organizationId: organization))
    }

    func testOrganizationSwitchDropsTheEarlierAnswer() async throws {
        let other = UUID()
        let script = Script([.gated(fullBody), .failure(URLError(.notConnectedToInternet))])
        let store = store(script)
        let first = Task { await store.load(organizationId: organization) }
        await fulfillment(of: [script.started], timeout: 5)
        // Студент сменил организацию, пока шёл запрос первой.
        await store.load(organizationId: other)
        XCTAssertEqual(store.phase, .failed(.connection))
        script.release()
        await first.value
        // Ответ для первой организации не попал на экран второй и не
        // записался её копией.
        XCTAssertNil(store.index)
        XCTAssertEqual(store.phase, .failed(.connection))
        XCTAssertNil(cache.read(organizationId: other))
        XCTAssertEqual(script.versions, [nil, nil])
    }
}
