import XCTest

/// Headless unit tests of `PortalCaseChatPolicy` — the pure merge/gating
/// rules the thread screen defers to (pattern: ProfileLanguagePolicyTests;
/// web mirror: `mergePortalCaseMessages`, src/lib/portal/messages.ts).
final class PortalCaseChatPolicyTests: XCTestCase {
    private func message(_ sequence: Int64, body: String = "…") -> PortalCaseChatMessage {
        PortalCaseChatMessage(
            id: UUID(),
            sequenceId: String(sequence),
            mine: false,
            authorName: "Куратор EVO",
            body: body,
            createdAt: "2026-09-19T12:00:00+00:00",
            attachmentKind: nil,
            attachmentLabel: nil,
            quotedBodyPreview: nil
        )
    }

    func testMergeReordersServerDescIntoAscendingDisplayOrder() {
        // RPC отдаёт NEWEST FIRST (200:187); экран рендерит старые сверху.
        let page = [message(42), message(41), message(40)]
        let merged = PortalCaseChatPolicy.merge([], page)
        XCTAssertEqual(merged.map(\.sequenceId), ["40", "41", "42"])
    }

    func testMergeDeduplicatesBySequenceIdPreferringIncoming() {
        let existing = [message(40), message(41, body: "старый снимок")]
        let refreshed = [message(42), message(41, body: "обновлённый снимок")]
        let merged = PortalCaseChatPolicy.merge(existing, refreshed)
        XCTAssertEqual(merged.map(\.sequenceId), ["40", "41", "42"])
        XCTAssertEqual(merged[1].body, "обновлённый снимок")
    }

    func testPollingMergeKeepsEarlierLoadedPages() {
        // Поллинг обновляет только первую страницу — загруженные ранние
        // страницы не выпадают из треда.
        let earlierPage = [message(10), message(9), message(8)]
        let firstPage = [message(42), message(41)]
        let thread = PortalCaseChatPolicy.merge(
            PortalCaseChatPolicy.merge([], firstPage),
            earlierPage
        )
        let polled = PortalCaseChatPolicy.merge(thread, [message(43)] + firstPage)
        XCTAssertEqual(polled.map(\.sequenceId), ["8", "9", "10", "41", "42", "43"])
    }

    func testMergeOrdersNumericallyNotLexicographically() {
        // BIGINT как строка: "9" < "10" численно, но не лексикографически.
        let merged = PortalCaseChatPolicy.merge([], [message(10), message(9)])
        XCTAssertEqual(merged.map(\.sequenceId), ["9", "10"])
    }

    func testSendableGateMirrorsServerBounds() {
        // btrim + 1..2000 (200:67-73).
        XCTAssertFalse(PortalCaseChatPolicy.isSendable(draft: "", isSending: false))
        XCTAssertFalse(PortalCaseChatPolicy.isSendable(draft: "   \n ", isSending: false))
        XCTAssertTrue(PortalCaseChatPolicy.isSendable(draft: "Добрый день!", isSending: false))
        XCTAssertFalse(PortalCaseChatPolicy.isSendable(draft: "Добрый день!", isSending: true))
        XCTAssertTrue(PortalCaseChatPolicy.isSendable(
            draft: String(repeating: "а", count: 2000),
            isSending: false
        ))
        XCTAssertFalse(PortalCaseChatPolicy.isSendable(
            draft: String(repeating: "а", count: 2001),
            isSending: false
        ))
    }
}
