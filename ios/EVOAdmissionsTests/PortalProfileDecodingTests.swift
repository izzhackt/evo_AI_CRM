import XCTest

/// Decoder tests against fixtures hand-written from the SQL return shapes of
/// `supabase/migrations/196_platform_portal_profile_language.sql`:
/// - `get_own_portal_profile_v1` — 196:99-105 `jsonb_build_object(
///   'displayName', 'email', 'portalLanguage', 'caseState',
///   'deletionRequestedAt')`; language COALESCEs to 'ru' (196:102)
/// - `set_own_portal_language_v1` — 196:153 `{'portalLanguage': p_language}`
/// - `request_account_deletion_v2` / `own_account_deletion_request_v1` — 279
///   `{'requestId', 'status', 'requestedAt', 'dueAt'}` or JSON null.
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

    func testDecodesOwnAccountDeletion() throws {
        // 279: request_account_deletion_v2 / own_account_deletion_request_v1
        // `{'requestId', 'status', 'requestedAt', 'dueAt'}`, due = request + 30 days.
        let fixture = """
        {
          "requestId": "7f6a1e9c-2b3d-4c5e-8f90-123456789abc",
          "status": "requested",
          "requestedAt": "2026-10-07T10:00:00.5+00:00",
          "dueAt": "2026-11-06T10:00:00.5+00:00"
        }
        """
        let request = try JSONDecoder().decode(OwnAccountDeletion.self, from: Data(fixture.utf8))
        XCTAssertEqual(request.requestId, UUID(uuidString: "7f6a1e9c-2b3d-4c5e-8f90-123456789abc"))
        XCTAssertFalse(request.isProcessing)
        XCTAssertEqual(AccountDeletionPolicy.dayLabel(from: request.requestedAt), "07.10.2026")
        XCTAssertEqual(AccountDeletionPolicy.dayLabel(from: request.dueAt), "06.11.2026")
    }

    func testDecodesNoOpenAccountDeletionAsNil() throws {
        // own_account_deletion_request_v1 returns JSON null without a request.
        let request = try JSONDecoder().decode(OwnAccountDeletion?.self, from: Data("null".utf8))
        XCTAssertNil(request)
    }

    func testProcessingAccountDeletion() throws {
        let fixture = """
        {"requestId": "7f6a1e9c-2b3d-4c5e-8f90-123456789abc", "status": "processing",
         "requestedAt": "2026-10-07T23:30:00+00:00", "dueAt": "2026-11-06T23:30:00+00:00"}
        """
        let request = try JSONDecoder().decode(OwnAccountDeletion.self, from: Data(fixture.utf8))
        XCTAssertTrue(request.isProcessing)
        // 23:30 UTC is already the next day in Bishkek (UTC+6).
        XCTAssertEqual(AccountDeletionPolicy.dayLabel(from: request.requestedAt), "08.10.2026")
    }

    func testOnlyUserNotFoundMeansTheAccountWasDeleted() {
        // 279 review finding 4: GET /user of a deleted account answers
        // user_not_found; a missing session or a bad token is not a deletion.
        XCTAssertTrue(DeletedAccountPolicy.isDeletedUser(authErrorCode: "user_not_found"))
        for code in [nil, "", "session_not_found", "bad_jwt", "refresh_token_not_found", "unexpected_failure"] {
            XCTAssertFalse(DeletedAccountPolicy.isDeletedUser(authErrorCode: code), code ?? "nil")
        }
    }
}
