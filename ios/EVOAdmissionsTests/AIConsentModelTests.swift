import XCTest

/// Состояние `AIConsentModel`: чтение, запись, сбои, повтор с тем же
/// `request_id`, гонка чтения и записи. Сервер подменяет сценарий, сети нет.
@MainActor
final class AIConsentModelTests: XCTestCase {
    private struct Boom: Error {}

    private final class Box<Value>: @unchecked Sendable {
        private let lock = NSLock()
        private var stored: Value
        init(_ value: Value) { stored = value }
        var value: Value {
            get { lock.withLock { stored } }
            set { lock.withLock { stored = newValue } }
        }
    }

    /// Одноразовые ворота: `wait()` ждёт `open()`, порядок вызовов не важен.
    private actor Gate {
        private var opened = false
        private var waiter: CheckedContinuation<Void, Never>?

        func wait() async {
            if opened { return }
            await withCheckedContinuation { waiter = $0 }
        }

        func open() {
            opened = true
            waiter?.resume()
            waiter = nil
        }
    }

    private let notAsked = AIConsent(status: nil, policyVersion: nil, decidedAt: nil, currentPolicyVersion: "2026-10-25")

    private func receipt(_ status: AIConsentStatus, current: String = "2026-10-25") -> AIConsent {
        AIConsent(status: status, policyVersion: "2026-10-25",
                  decidedAt: "2026-10-25T09:30:00+00:00", currentPolicyVersion: current)
    }

    private struct Harness {
        let model: AIConsentModel
        let stored: Box<AIConsent>
        let loadFails: Box<Bool>
        let saveFails: Box<Bool>
        let sent: Box<[AIConsentSetParams]>
    }

    private func harness(initial: AIConsent) -> Harness {
        let stored = Box(initial)
        let loadFails = Box(false)
        let saveFails = Box(false)
        let sent = Box<[AIConsentSetParams]>([])
        let model = AIConsentModel(
            load: {
                if loadFails.value { throw Boom() }
                return stored.value
            },
            save: { params in
                sent.value.append(params)
                if saveFails.value { throw Boom() }
                let status = AIConsentStatus(rawValue: params.p_status)!
                let saved = AIConsent(status: status, policyVersion: params.p_policy_version,
                                      decidedAt: "2026-10-25T09:30:00+00:00",
                                      currentPolicyVersion: stored.value.currentPolicyVersion)
                stored.value = saved
                return saved
            }
        )
        return Harness(model: model, stored: stored, loadFails: loadFails, saveFails: saveFails, sent: sent)
    }

    // MARK: Чтение

    func testStartsLoadingThenShowsServerState() async {
        let h = harness(initial: notAsked)
        XCTAssertEqual(h.model.phase, .loading)
        XCTAssertNil(h.model.consent)
        await h.model.load()
        XCTAssertEqual(h.model.phase, .loaded(notAsked))
    }

    func testFailedFirstReadIsFailedNotUnasked() async {
        let h = harness(initial: notAsked)
        h.loadFails.value = true
        await h.model.load()
        XCTAssertEqual(h.model.phase, .failed)
        XCTAssertNil(h.model.consent)
        h.loadFails.value = false
        await h.model.load()
        XCTAssertEqual(h.model.phase, .loaded(notAsked))
    }

    func testFailedRefreshKeepsTheShownDecision() async {
        let h = harness(initial: receipt(.granted))
        await h.model.load()
        h.loadFails.value = true
        await h.model.load()
        XCTAssertEqual(h.model.phase, .loaded(receipt(.granted)))
    }

    func testCancelledFirstReadDoesNotLeaveTheModelLoading() async {
        // Главную закрыли, пока шло первое чтение: строка «Профиля» не должна
        // вертеть индикатор без повтора (вызов, пришедший за это время,
        // отброшен, пока чтение идёт).
        let started = Gate()
        let reads = Box(0)
        let model = AIConsentModel(
            load: {
                let call = reads.value
                reads.value += 1
                if call == 0 {
                    await started.open()
                    try await Task.sleep(nanoseconds: 60_000_000_000)
                }
                return AIConsent(status: nil, policyVersion: nil, decidedAt: nil, currentPolicyVersion: "2026-10-25")
            },
            save: { _ in throw Boom() }
        )
        let first = Task { await model.load() }
        await started.wait()
        await model.load()
        XCTAssertEqual(model.phase, .loading, "второй вызов отброшен, первое чтение ещё идёт")
        first.cancel()
        await first.value
        XCTAssertEqual(model.phase, .failed)
        XCTAssertNil(model.consent)

        await model.load()
        XCTAssertEqual(model.phase, .loaded(notAsked))
    }

    func testCancelledRefreshKeepsTheShownDecision() async {
        let started = Gate()
        let reads = Box(0)
        let model = AIConsentModel(
            load: {
                let call = reads.value
                reads.value += 1
                if call == 1 {
                    await started.open()
                    try await Task.sleep(nanoseconds: 60_000_000_000)
                }
                return AIConsent(status: .granted, policyVersion: "2026-10-25",
                                 decidedAt: "2026-10-25T09:30:00+00:00", currentPolicyVersion: "2026-10-25")
            },
            save: { _ in throw Boom() }
        )
        await model.load()
        let refresh = Task { await model.load() }
        await started.wait()
        refresh.cancel()
        await refresh.value
        XCTAssertEqual(model.phase, .loaded(receipt(.granted)))
    }

    func testRefreshPicksUpAChangeMadeElsewhere() async {
        let h = harness(initial: notAsked)
        await h.model.load()
        h.stored.value = receipt(.declined)
        await h.model.load()
        XCTAssertEqual(h.model.consent?.status, .declined)
    }

    // MARK: Запись

    func testChooseSendsTheContractAndShowsTheServerReceipt() async throws {
        let h = harness(initial: notAsked)
        await h.model.load()
        await h.model.choose(.granted)
        let sent = try XCTUnwrap(h.sent.value.first)
        XCTAssertEqual(h.sent.value.count, 1)
        XCTAssertEqual(sent.p_status, "granted")
        XCTAssertEqual(sent.p_policy_version, "2026-10-25")
        XCTAssertEqual(sent.p_source, "ios")
        XCTAssertEqual(h.model.consent?.status, .granted)
        XCTAssertNil(h.model.sending)
        XCTAssertFalse(h.model.sendFailed)
        XCTAssertFalse(AIConsentPolicy.needsDecision(try XCTUnwrap(h.model.consent)))
    }

    func testFailedSaveChangesNothingAndRetryReusesTheRequestId() async throws {
        let h = harness(initial: notAsked)
        await h.model.load()
        h.saveFails.value = true
        await h.model.choose(.granted)
        XCTAssertTrue(h.model.sendFailed)
        XCTAssertNil(h.model.sending)
        XCTAssertEqual(h.model.phase, .loaded(notAsked))

        h.saveFails.value = false
        await h.model.choose(.granted)
        XCTAssertFalse(h.model.sendFailed)
        XCTAssertEqual(h.model.consent?.status, .granted)
        XCTAssertEqual(h.sent.value.count, 2)
        XCTAssertEqual(h.sent.value[0].p_request_id, h.sent.value[1].p_request_id)
    }

    func testFailedSaveWithoutNetworkKeepsTheScreenAsItWas() async {
        let h = harness(initial: notAsked)
        await h.model.load()
        h.saveFails.value = true
        h.loadFails.value = true
        await h.model.choose(.granted)
        XCTAssertTrue(h.model.sendFailed)
        XCTAssertNil(h.model.sending)
        XCTAssertEqual(h.model.phase, .loaded(notAsked), "сбой перечитывания ничего не стирает")
    }

    func testRejectedSaveRereadsAndAsksToUpdateWhenTheServerBumpedTheText() async throws {
        // Сервер сменил версию текста между чтением и записью и отклонил запись.
        let stored = Box(notAsked)
        let model = AIConsentModel(load: { stored.value }, save: { _ in throw Boom() })
        await model.load()
        XCTAssertTrue(AIConsentPolicy.isTextCurrent(try XCTUnwrap(model.consent)))
        stored.value = AIConsent(status: nil, policyVersion: nil, decidedAt: nil, currentPolicyVersion: "2026-12-01")
        await model.choose(.granted)
        XCTAssertTrue(model.sendFailed)
        XCTAssertNil(model.sending)
        let after = try XCTUnwrap(model.consent)
        XCTAssertEqual(after.currentPolicyVersion, "2026-12-01")
        XCTAssertFalse(AIConsentPolicy.isTextCurrent(after), "теперь экран просит обновить приложение")
    }

    func testOtherChoiceAfterFailureAndNextDecisionGetNewRequestIds() async {
        let h = harness(initial: notAsked)
        await h.model.load()
        h.saveFails.value = true
        await h.model.choose(.granted)
        h.saveFails.value = false
        await h.model.choose(.declined)
        await h.model.choose(.granted)
        let ids = h.sent.value.map(\.p_request_id)
        XCTAssertEqual(ids.count, 3)
        XCTAssertEqual(Set(ids).count, 3)
    }

    func testChooseNeedsALoadedStateAndACurrentText() async {
        let h = harness(initial: notAsked)
        await h.model.choose(.granted)
        XCTAssertTrue(h.sent.value.isEmpty, "до чтения ничего не отправляется")

        let outdated = AIConsent(status: nil, policyVersion: nil, decidedAt: nil, currentPolicyVersion: "2026-12-01")
        let old = harness(initial: outdated)
        await old.model.load()
        await old.model.choose(.granted)
        XCTAssertTrue(old.sent.value.isEmpty, "чужую версию текста сервер отклонил бы")
        XCTAssertFalse(old.model.sendFailed)
    }

    func testSecondTapWhileSendingIsIgnored() async {
        let started = Gate()
        let release = Gate()
        let sent = Box<[AIConsentSetParams]>([])
        let model = AIConsentModel(
            load: { AIConsent(status: nil, policyVersion: nil, decidedAt: nil, currentPolicyVersion: "2026-10-25") },
            save: { params in
                sent.value.append(params)
                await started.open()
                await release.wait()
                return AIConsent(status: .granted, policyVersion: "2026-10-25",
                                 decidedAt: "2026-10-25T09:30:00+00:00", currentPolicyVersion: "2026-10-25")
            }
        )
        await model.load()
        let first = Task { await model.choose(.granted) }
        await started.wait()
        XCTAssertEqual(model.sending, .granted)
        await model.choose(.declined)
        await release.open()
        await first.value
        XCTAssertEqual(sent.value.map(\.p_status), ["granted"])
        XCTAssertEqual(model.consent?.status, .granted)
    }

    func testReadStartedBeforeASaveDoesNotOverwriteIt() async {
        let started = Gate()
        let release = Gate()
        let reads = Box(0)
        let model = AIConsentModel(
            load: {
                let call = reads.value
                reads.value += 1
                if call == 0 {
                    return AIConsent(status: nil, policyVersion: nil, decidedAt: nil, currentPolicyVersion: "2026-10-25")
                }
                // Второе чтение начато до записи и отвечает позже: данные устарели.
                await started.open()
                await release.wait()
                return AIConsent(status: nil, policyVersion: nil, decidedAt: nil, currentPolicyVersion: "2026-10-25")
            },
            save: { _ in
                AIConsent(status: .declined, policyVersion: "2026-10-25",
                          decidedAt: "2026-10-25T09:30:00+00:00", currentPolicyVersion: "2026-10-25")
            }
        )
        await model.load()
        let slowRead = Task { await model.load() }
        await started.wait()
        await model.choose(.declined)
        await release.open()
        await slowRead.value
        XCTAssertEqual(model.consent?.status, .declined)
    }
}
