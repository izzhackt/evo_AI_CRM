import XCTest

/// Decoder tests against fixtures hand-written from the SQL return shapes of
/// `supabase/migrations/196_platform_portal_profile_language.sql`:
/// - `get_own_portal_profile_v1` — 196:99-105 `jsonb_build_object(
///   'displayName', 'email', 'portalLanguage', 'caseState',
///   'deletionRequestedAt')`; language COALESCEs to 'ru' (196:102)
/// - `set_own_portal_language_v1` — 196:153 `{'portalLanguage': p_language}`
/// - `request_account_deletion_v1` — 196:189-193 `{'requestId', 'status',
///   'requestedAt'}`, status ∈ requested|acknowledged (CHECK 196:40-41).
final class PortalProfileDecodingTests: XCTestCase {
    func testDecodesFullProfile() throws {
        let fixture = """
        {
          "displayName": "Айдана Осмонова",
          "email": "aidana@example.com",
          "portalLanguage": "ky",
          "caseState": "pending",
          "deletionRequestedAt": null
        }
        """
        let profile = try JSONDecoder().decode(PortalProfile.self, from: Data(fixture.utf8))
        XCTAssertEqual(profile.displayName, "Айдана Осмонова")
        XCTAssertEqual(profile.email, "aidana@example.com")
        XCTAssertEqual(profile.portalLanguage, "ky")
        XCTAssertEqual(profile.caseState, "pending")
        XCTAssertNil(profile.deletionRequestedAt)
        XCTAssertFalse(profile.hasOpenDeletionRequest)
    }

    func testDecodesProfileWithOpenDeletionRequest() throws {
        // 196:94-98: deletionRequestedAt is the created_at of the newest OPEN
        // request — this is what makes «запрос отправлен» survive a relaunch.
        let fixture = """
        {
          "displayName": "Нурлан Джумабеков",
          "email": "nurlan@example.com",
          "portalLanguage": "ru",
          "caseState": "active",
          "deletionRequestedAt": "2026-09-19T09:00:00.5+00:00"
        }
        """
        let profile = try JSONDecoder().decode(PortalProfile.self, from: Data(fixture.utf8))
        XCTAssertTrue(profile.hasOpenDeletionRequest)
        XCTAssertNotNil(PostgresTimestamp.date(from: profile.deletionRequestedAt ?? ""))
    }

    func testDecodesProfileWithoutOwnCase() throws {
        // 196:81-92: no resolvable own case leaves caseState NULL and the
        // language reads as the honest default 'ru' (COALESCE 196:102).
        let fixture = """
        {
          "displayName": "Тимур Алиев",
          "email": "timur@example.com",
          "portalLanguage": "ru",
          "caseState": null,
          "deletionRequestedAt": null
        }
        """
        let profile = try JSONDecoder().decode(PortalProfile.self, from: Data(fixture.utf8))
        XCTAssertNil(profile.caseState)
        XCTAssertEqual(profile.portalLanguage, "ru")
    }

    func testDecodesLanguageReceipt() throws {
        // 196:153.
        let receipt = try JSONDecoder().decode(
            PortalLanguageReceipt.self,
            from: Data(#"{"portalLanguage": "ky"}"#.utf8)
        )
        XCTAssertEqual(receipt.portalLanguage, "ky")
    }

    func testDecodesDeletionReceipt() throws {
        // 196:189-193; a replay with a NEW request_id returns the ORIGINAL
        // open request (196:176-182), so requestId may differ from the sent one.
        let fixture = """
        {
          "requestId": "7f6a1e9c-2b3d-4c5e-8f90-123456789abc",
          "status": "requested",
          "requestedAt": "2026-09-19T09:00:00+00:00"
        }
        """
        let receipt = try JSONDecoder().decode(
            AccountDeletionReceipt.self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(
            receipt.requestId,
            UUID(uuidString: "7f6a1e9c-2b3d-4c5e-8f90-123456789abc")
        )
        XCTAssertEqual(receipt.status, "requested")
    }
}
