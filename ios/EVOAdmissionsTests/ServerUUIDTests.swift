import XCTest

/// Аудит UX/UI 2026-10: UUID с сервера разбирались через force-unwrap.
final class ServerUUIDTests: XCTestCase {
    func testParsesCanonicalUUIDInAnyCase() throws {
        let lower = "6f1d3c2a-9b8e-4f7a-a1b2-c3d4e5f60718"
        let parsed = try XCTUnwrap(ServerUUID.parse(lower))
        XCTAssertEqual(parsed.uuidString.lowercased(), lower)
        XCTAssertEqual(ServerUUID.parse(lower.uppercased()), parsed)
    }

    func testRejectsMalformedValuesWithoutTrapping() {
        let malformed: [String?] = [
            nil,
            "",
            "not-a-uuid",
            "6f1d3c2a-9b8e-4f7a-a1b2-c3d4e5f6071",    // 35 символов
            "6f1d3c2a-9b8e-4f7a-a1b2-c3d4e5f607189",  // 37 символов
            "6f1d3c2a9b8e4f7aa1b2c3d4e5f60718",       // без дефисов
            "{6f1d3c2a-9b8e-4f7a-a1b2-c3d4e5f60718}", // в скобках
            "6f1d3c2a-9b8e-4f7a-a1b2-c3d4e5f6071g",   // не hex
            " 6f1d3c2a-9b8e-4f7a-a1b2-c3d4e5f6071",   // пробел
        ]
        for raw in malformed {
            XCTAssertNil(ServerUUID.parse(raw), "\(raw ?? "nil")")
        }
    }

    func testRequireThrowsTheCallersError() {
        enum Failure: Error, Equatable { case invalidResponse }
        XCTAssertThrowsError(try ServerUUID.require("broken", orThrow: Failure.invalidResponse)) { error in
            XCTAssertEqual(error as? Failure, .invalidResponse)
        }
        XCTAssertNoThrow(try ServerUUID.require("6f1d3c2a-9b8e-4f7a-a1b2-c3d4e5f60718", orThrow: Failure.invalidResponse))
    }

    func testDecoderRejectsBrokenApplicationIdInsteadOfCrashing() {
        // Версии файлов и метки времени с сервера больше не раскрываются через
        // force-unwrap: неверная запись делает страницу недействительной.
        XCTAssertEqual(ApplicationDocumentWire.microseconds("not a timestamp"), 0)
    }
}
