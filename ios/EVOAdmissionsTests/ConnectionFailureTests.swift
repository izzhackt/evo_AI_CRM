import XCTest

/// Проход «проще и дружелюбнее» (26.10.2026): под заголовком «Не удалось
/// загрузить…» больше нет текста системы (`error.localizedDescription`), а
/// сбой связи при создании аккаунта не считается потерянным ответом.
final class ConnectionFailureTests: XCTestCase {
    private func urlError(_ code: URLError.Code) -> URLError { URLError(code) }

    func testNoConnectionErrorsAreTransportAndNeverReachedTheServer() {
        for code: URLError.Code in [.notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed] {
            XCTAssertTrue(ConnectionFailure.isTransport(urlError(code)), "\(code)")
            XCTAssertTrue(ConnectionFailure.neverReachedServer(urlError(code)), "\(code)")
        }
    }

    /// Обрыв и таймаут: ответ мог потеряться уже после выполнения запроса,
    /// поэтому «не дошло до сервера» говорить нельзя (создание аккаунта
    /// остаётся в завершённом состоянии «напишите в поддержку»).
    func testDroppedConnectionAndTimeoutMayHaveReachedTheServer() {
        for code: URLError.Code in [.networkConnectionLost, .timedOut] {
            XCTAssertTrue(ConnectionFailure.isTransport(urlError(code)), "\(code)")
            XCTAssertFalse(ConnectionFailure.neverReachedServer(urlError(code)), "\(code)")
        }
    }

    func testOtherErrorsAreNeitherTransportNorUnreached() {
        struct Other: Error {}
        XCTAssertFalse(ConnectionFailure.isTransport(Other()))
        XCTAssertFalse(ConnectionFailure.neverReachedServer(Other()))
        XCTAssertFalse(ConnectionFailure.isTransport(urlError(.badServerResponse)))
        XCTAssertFalse(ConnectionFailure.neverReachedServer(urlError(.cancelled)))
    }

    func testHintKeyDependsOnlyOnTheKindOfFailure() {
        struct Other: Error { var localizedDescription: String { "System text must never be shown" } }
        XCTAssertEqual(ConnectionFailure.hintKey(for: urlError(.notConnectedToInternet)), "error_hint_offline")
        XCTAssertEqual(ConnectionFailure.hintKey(for: urlError(.timedOut)), "error_hint_offline")
        XCTAssertEqual(ConnectionFailure.hintKey(for: Other()), "error_hint_retry")
    }
}
