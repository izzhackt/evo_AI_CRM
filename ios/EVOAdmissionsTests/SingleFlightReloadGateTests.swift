import XCTest

/// Review #912 (medium): смена фильтров во время полёта. Контракт затвора:
/// (1) результат устаревшего поколения отбрасывается, (2) полёт
/// перезапускается уже с актуальными фильтрами, (3) повторные вызовы во
/// время полёта не создают параллельных загрузок.
@MainActor
final class SingleFlightReloadGateTests: XCTestCase {

    /// Состояние «RPC в полёте» с явным резюмом — детерминированная
    /// имитация медленной загрузки; всё на MainActor, гонок в тесте нет.
    @MainActor
    private final class Probe {
        var filters = "A"
        var attempted: [String] = []
        var published: [String] = []
        var pending: [CheckedContinuation<Void, Never>] = []
        var inFlight = 0
        var maxInFlight = 0

        func attempt() async -> () -> Void {
            let requested = filters
            attempted.append(requested)
            inFlight += 1
            maxInFlight = max(maxInFlight, inFlight)
            await withCheckedContinuation { pending.append($0) }
            inFlight -= 1
            return { self.published.append(requested) }
        }

        func resumeNext() {
            pending.removeFirst().resume()
        }
    }

    private func waitUntil(
        file: StaticString = #filePath,
        line: UInt = #line,
        _ condition: () -> Bool
    ) async {
        for _ in 0..<5000 {
            if condition() { return }
            await Task.yield()
        }
        XCTAssertTrue(condition(), "condition not reached", file: file, line: line)
    }

    func testStaleResultIsDroppedAndFlightRerunsWithFreshFilters() async {
        let gate = SingleFlightReloadGate()
        let probe = Probe()

        let flight = Task { @MainActor in
            await gate.run { await probe.attempt() }
        }
        await waitUntil { probe.pending.count == 1 }
        XCTAssertEqual(probe.attempted, ["A"])

        // Смена фильтров A→B в середине полёта.
        probe.filters = "B"
        gate.invalidate()
        probe.resumeNext()

        // (2) затвор сам перезапускает попытку — уже с новыми фильтрами.
        await waitUntil { probe.pending.count == 1 }
        XCTAssertEqual(probe.attempted, ["A", "B"])
        probe.resumeNext()
        _ = await flight.value

        // (1) результат старых фильтров не опубликован — только B.
        XCTAssertEqual(probe.published, ["B"])
    }

    func testCallsDuringFlightDoNotStartParallelRuns() async {
        let gate = SingleFlightReloadGate()
        let probe = Probe()

        let flight = Task { @MainActor in
            await gate.run { await probe.attempt() }
        }
        await waitUntil { probe.pending.count == 1 }

        // (3) быстрая двойная смена фильтров + повторные вызовы во время
        // полёта: параллельного сбора нет, вызовы честно отклонены.
        gate.invalidate()
        let second = await gate.run {
            XCTFail("parallel attempt must not start")
            return {}
        }
        gate.invalidate()
        let third = await gate.run {
            XCTFail("parallel attempt must not start")
            return {}
        }
        XCTAssertFalse(second)
        XCTAssertFalse(third)
        XCTAssertEqual(probe.attempted.count, 1)

        // Два invalidate за один полёт → ОДИН перезапуск (поколение
        // перечитывается на границе попытки), не два.
        probe.resumeNext()
        await waitUntil { probe.pending.count == 1 }
        XCTAssertEqual(probe.attempted.count, 2)
        probe.resumeNext()
        _ = await flight.value
        XCTAssertEqual(probe.attempted.count, 2)
        XCTAssertEqual(probe.maxInFlight, 1)
        XCTAssertEqual(probe.published.count, 1)
    }

    func testFreshResultPublishesWithoutRerun() async {
        let gate = SingleFlightReloadGate()
        var published = 0
        let ran = await gate.run { { published += 1 } }
        XCTAssertTrue(ran)
        XCTAssertEqual(published, 1)
        XCTAssertFalse(gate.isRunning)
    }
}
