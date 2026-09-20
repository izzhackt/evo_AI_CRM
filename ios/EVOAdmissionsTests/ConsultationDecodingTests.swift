import XCTest

/// Decoder tests against fixtures hand-written from the SQL return shape of
/// `supabase/migrations/197_platform_portal_consultation_requests.sql`:
/// `platform_private.portal_consultation_receipt` (197:88-97) — the ONE shape
/// both `create_portal_consultation_request_v1` and
/// `own_portal_consultation_requests_v1` return: `{requestId, status,
/// institutionId, institutionName, note, requestedAt, handledAt}`.
final class ConsultationDecodingTests: XCTestCase {
    func testDecodesOpenReceiptWithInstitution() throws {
        // institutionName resolves from the latest published publication
        // (197:74-82); note is the student's free text (197:41, ≤500).
        let fixture = """
        {
          "requestId": "7f6a1e9c-2b3d-4c5e-8f90-123456789abc",
          "status": "requested",
          "institutionId": "3b8fbd2e-6c1a-4c9e-9a71-0e6f4b1f2a10",
          "institutionName": "Sunway University",
          "note": "Удобно после 18:00.",
          "requestedAt": "2026-09-19T10:23:54.123456+00:00",
          "handledAt": null
        }
        """
        let receipt = try JSONDecoder().decode(
            ConsultationReceipt.self,
            from: Data(fixture.utf8)
        )
        XCTAssertTrue(receipt.isOpen)
        XCTAssertEqual(receipt.institutionName, "Sunway University")
        XCTAssertEqual(receipt.note, "Удобно после 18:00.")
        XCTAssertNil(receipt.handledAt)
        XCTAssertNotNil(PostgresTimestamp.date(from: receipt.requestedAt))
    }

    func testDecodesHandledReceiptWithoutInstitution() throws {
        // Запрос из профиля: institution_id NULL → institutionName NULL
        // (CASE 197:92-93); handled требует handled_at (CHECK 197:47-52).
        let fixture = """
        {
          "requestId": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
          "status": "handled",
          "institutionId": null,
          "institutionName": null,
          "note": null,
          "requestedAt": "2026-09-10T08:00:00+00:00",
          "handledAt": "2026-09-11T12:30:00+00:00"
        }
        """
        let receipt = try JSONDecoder().decode(
            ConsultationReceipt.self,
            from: Data(fixture.utf8)
        )
        XCTAssertFalse(receipt.isOpen)
        XCTAssertNil(receipt.institutionId)
        XCTAssertNil(receipt.institutionName)
        XCTAssertNil(receipt.note)
        XCTAssertNotNil(receipt.handledAt)
    }

    func testDecodesOwnRequestsListNewestFirst() throws {
        // 197:171-181: jsonb_agg of receipts ORDER BY created_at DESC, cap 20;
        // COALESCE to [] on no rows.
        let fixture = """
        [
          {
            "requestId": "7f6a1e9c-2b3d-4c5e-8f90-123456789abc",
            "status": "requested",
            "institutionId": null,
            "institutionName": null,
            "note": "Вопрос по документам.",
            "requestedAt": "2026-09-19T10:00:00+00:00",
            "handledAt": null
          },
          {
            "requestId": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
            "status": "handled",
            "institutionId": "3b8fbd2e-6c1a-4c9e-9a71-0e6f4b1f2a10",
            "institutionName": "Sunway University",
            "note": null,
            "requestedAt": "2026-09-10T08:00:00+00:00",
            "handledAt": "2026-09-11T12:30:00+00:00"
          }
        ]
        """
        let receipts = try JSONDecoder().decode(
            [ConsultationReceipt].self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(receipts.count, 2)
        XCTAssertTrue(receipts[0].isOpen)
        XCTAssertFalse(receipts[1].isOpen)
    }

    func testDecodesEmptyList() throws {
        let receipts = try JSONDecoder().decode(
            [ConsultationReceipt].self,
            from: Data("[]".utf8)
        )
        XCTAssertTrue(receipts.isEmpty)
    }
}
