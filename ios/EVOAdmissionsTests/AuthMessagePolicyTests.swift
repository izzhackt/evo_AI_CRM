import XCTest

/// Вход и «Забыли пароль?» (общий контракт веба и iPhone, аудит UX/UI 2026-10).
final class AuthMessagePolicyTests: XCTestCase {
    private typealias Failure = AuthMessagePolicy.Failure

    func testSignInErrorsComeFromTheCatalogNotFromTheServer() {
        XCTAssertEqual(AuthMessagePolicy.signInMessageKey(Failure(errorCode: "invalid_credentials", httpStatus: 400)),
                       "sign_in_error_invalid_credentials")
        XCTAssertEqual(AuthMessagePolicy.signInMessageKey(Failure(errorCode: nil, httpStatus: 400)),
                       "sign_in_error_invalid_credentials")
        XCTAssertEqual(AuthMessagePolicy.signInMessageKey(Failure(errorCode: "email_not_confirmed", httpStatus: 400)),
                       "sign_in_error_email_not_confirmed")
        XCTAssertEqual(AuthMessagePolicy.signInMessageKey(Failure(errorCode: "over_request_rate_limit", httpStatus: 429)),
                       "sign_in_error_rate_limited")
        XCTAssertEqual(AuthMessagePolicy.signInMessageKey(Failure(isTransport: true)), "sign_in_error_network")
        XCTAssertEqual(AuthMessagePolicy.signInMessageKey(Failure(errorCode: "unexpected_failure", httpStatus: 500)),
                       "sign_in_error_generic")
    }

    func testRecoveryNeverRevealsWhetherTheAccountExists() {
        // Успех и коды, зависящие от наличия аккаунта, дают один и тот же ответ.
        XCTAssertEqual(AuthMessagePolicy.recoveryOutcome(nil), .sent)
        for code in ["user_not_found", "email_not_confirmed", "user_banned"] {
            XCTAssertEqual(AuthMessagePolicy.recoveryOutcome(Failure(errorCode: code, httpStatus: 400)), .sent, code)
        }
        XCTAssertEqual(AuthMessagePolicy.recoveryMessageKey(.sent), "forgot_password_sent")
    }

    func testRecoveryRateLimitAndFailuresAreExplicit() {
        XCTAssertEqual(AuthMessagePolicy.recoveryOutcome(Failure(errorCode: "over_email_send_rate_limit", httpStatus: 429)),
                       .rateLimited)
        XCTAssertEqual(AuthMessagePolicy.recoveryOutcome(Failure(errorCode: nil, httpStatus: 429)), .rateLimited)
        XCTAssertEqual(AuthMessagePolicy.recoveryOutcome(Failure(errorCode: "email_address_invalid", httpStatus: 400)),
                       .invalidEmail)
        XCTAssertEqual(AuthMessagePolicy.recoveryOutcome(Failure(isTransport: true)), .failed)
        XCTAssertEqual(AuthMessagePolicy.recoveryOutcome(Failure(errorCode: "unexpected_failure", httpStatus: 500)), .failed)
        XCTAssertEqual(AuthMessagePolicy.recoveryMessageKey(.rateLimited), "forgot_password_rate_limited")
    }

    func testRecoveryLinkPointsAtTheStudentWebCallback() throws {
        XCTAssertEqual(
            AuthMessagePolicy.recoveryRedirect(webBase: try XCTUnwrap(URL(string: "https://app.evoadmissions.com")))?.absoluteString,
            "https://app.evoadmissions.com/auth/callback"
        )
        // Путь базового адреса не тянется в ссылку, порт сохраняется.
        XCTAssertEqual(
            AuthMessagePolicy.recoveryRedirect(webBase: try XCTUnwrap(URL(string: "http://app.localhost:3110/portal/")))?.absoluteString,
            "http://app.localhost:3110/auth/callback"
        )
        XCTAssertNil(AuthMessagePolicy.recoveryRedirect(webBase: try XCTUnwrap(URL(string: "mailto:evoadmissions@gmail.com"))))
    }

    func testEmailShapeCheck() {
        XCTAssertTrue(AuthMessagePolicy.looksLikeEmail("  student@example.com "))
        for raw in ["", "student", "student@", "@example.com", "student@example", "student@example.", "a b@example.com", "a@b@example.com"] {
            XCTAssertFalse(AuthMessagePolicy.looksLikeEmail(raw), raw)
        }
        XCTAssertEqual(AuthMessagePolicy.normalizedEmail(" student@example.com\n"), "student@example.com")
    }
}
