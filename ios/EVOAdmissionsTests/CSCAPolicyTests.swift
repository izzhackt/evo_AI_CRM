import XCTest

final class CSCAPolicyTests: XCTestCase {
    // MARK: Time

    func testTimestampKeepsTheFraction() throws {
        let a = try XCTUnwrap(CSCATime.date(from: "2026-10-16T10:36:49.712211+00:00"))
        let b = try XCTUnwrap(CSCATime.date(from: "2026-10-16T10:36:49+00:00"))
        XCTAssertEqual(a.timeIntervalSince(b), 0.712211, accuracy: 0.000001)
    }

    func testBishkekDays() {
        XCTAssertEqual(CSCATime.daysBetween("2026-10-16", "2026-11-14"), 29)
        XCTAssertEqual(CSCATime.daysBetween("2026-10-16", "2026-10-16"), 0)
        XCTAssertNil(CSCATime.daysBetween("2026-10-16", "not a date"))
    }

    // MARK: Server clock (contract §7.2)

    func testClockFromServerNow() throws {
        let attempt = try CSCADecodingTests.decode(CSCATestAttempt.self, "csca_test_start_diagnostic")
        let server = try XCTUnwrap(CSCATime.date(from: attempt.serverNow))
        // The response arrived at monotonic second 5000.
        let clock = try XCTUnwrap(CSCAServerClock(serverNow: attempt.serverNow, receivedAt: 5000))
        XCTAssertEqual(clock.serverTime(at: 5000), server)
        XCTAssertEqual(clock.serverTime(at: 5010).timeIntervalSince(server), 10, accuracy: 0.001)
        let deadline = try XCTUnwrap(CSCATime.date(from: attempt.deadlineAt))
        // Right after the response the full duration is left on the server clock.
        XCTAssertEqual(clock.remaining(until: deadline, at: 5000), 240, accuracy: 0.01)
        XCTAssertEqual(clock.remaining(until: deadline, at: 5060), 180, accuracy: 0.01)
        // 300 seconds later the test is over: never negative.
        XCTAssertEqual(clock.remaining(until: deadline, at: 5300), 0)
    }

    /// The countdown runs on monotonic seconds only: no input is the device
    /// wall clock, so a student changing the phone's time cannot move it.
    func testClockIgnoresTheDeviceTime() {
        let server = Date(timeIntervalSince1970: 1_000_000)
        let clock = CSCAServerClock(serverAtAnchor: server, anchor: 42)
        let deadline = server.addingTimeInterval(450)
        XCTAssertEqual(clock.remaining(until: deadline, at: 42 + 100), 350, accuracy: 0.001)
        let a = CSCAMonotonic.now()
        let b = CSCAMonotonic.now()
        XCTAssertGreaterThanOrEqual(b, a)
    }

    func testSavesAcceptedUntilDeadlinePlusGrace() {
        let clock = CSCAServerClock(serverAtAnchor: Date(timeIntervalSince1970: 0), anchor: 0)
        let deadline = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(clock.acceptsSave(deadline: deadline, graceSeconds: 15, at: 1_014))
        XCTAssertFalse(clock.acceptsSave(deadline: deadline, graceSeconds: 15, at: 1_015))
    }

    func testCountdownLabel() {
        XCTAssertEqual(CSCACountdown.label(2467), "41:07")
        XCTAssertEqual(CSCACountdown.label(0.2), "00:01", "rounds up: 00:00 only when time is out")
        XCTAssertEqual(CSCACountdown.label(0), "00:00")
        XCTAssertEqual(CSCACountdown.label(3600), "1:00:00")
    }

    // MARK: Save schedule (contract §7.3)

    func testSaveSchedule() {
        let t0: TimeInterval = 0
        let at = { (s: TimeInterval) in s }
        // Nothing changed or a request in flight: never.
        XCTAssertFalse(CSCASaveSchedule.shouldSave(trigger: .background, isDirty: false, inFlight: false, lastSaveAt: t0, now: at(60)))
        XCTAssertFalse(CSCASaveSchedule.shouldSave(trigger: .background, isDirty: true, inFlight: true, lastSaveAt: t0, now: at(60)))
        // Batch every 10 s.
        XCTAssertFalse(CSCASaveSchedule.shouldSave(trigger: .tick, isDirty: true, inFlight: false, lastSaveAt: t0, now: at(9)))
        XCTAssertTrue(CSCASaveSchedule.shouldSave(trigger: .tick, isDirty: true, inFlight: false, lastSaveAt: t0, now: at(10)))
        // Moving between items: not more often than every 2 s.
        XCTAssertFalse(CSCASaveSchedule.shouldSave(trigger: .navigation, isDirty: true, inFlight: false, lastSaveAt: t0, now: at(1.5)))
        XCTAssertTrue(CSCASaveSchedule.shouldSave(trigger: .navigation, isDirty: true, inFlight: false, lastSaveAt: t0, now: at(2)))
        // Background and deadline: at once; first save ever: at once.
        XCTAssertTrue(CSCASaveSchedule.shouldSave(trigger: .background, isDirty: true, inFlight: false, lastSaveAt: t0, now: at(0.1)))
        XCTAssertTrue(CSCASaveSchedule.shouldSave(trigger: .deadline, isDirty: true, inFlight: false, lastSaveAt: t0, now: at(0.1)))
        XCTAssertTrue(CSCASaveSchedule.shouldSave(trigger: .tick, isDirty: true, inFlight: false, lastSaveAt: nil, now: at(0)))
    }

    func testItemTimerAccumulatesAndClamps() {
        var timer = CSCAItemTimer(initial: ["a": 3590])
        timer.enter("a", at: 0)
        timer.enter("b", at: 30)
        XCTAssertEqual(timer.seconds["a"], 3600, "server range is 0..3600")
        timer.pause(at: 42)
        XCTAssertEqual(timer.seconds["b"], 12)
        // Paused: time in the background does not count.
        timer.flush(at: 500)
        XCTAssertEqual(timer.seconds["b"], 12)
    }

    // MARK: Failures (contract §1.1), with the real error bodies

    func testFailureClassificationFromRealErrors() throws {
        struct ErrorBody: Decodable { let code: String; let message: String }
        func classify(_ name: String) throws -> CSCAFailure {
            let body = try JSONDecoder().decode(ErrorBody.self, from: CSCADecodingTests.fixture(name))
            return CSCAFailure.classify(code: body.code, message: body.message, isTransport: false)
        }
        XCTAssertEqual(try classify("csca_error_stale_revision.error"), .conflict)
        XCTAssertEqual(try classify("csca_error_mock_early_finish.error"), .earlyFinishForbidden)
        XCTAssertEqual(try classify("csca_error_test_completed.error"), .testCompleted)
        XCTAssertEqual(try classify("csca_error_review_not_due.error"), .reviewNotDue)
        XCTAssertEqual(try classify("csca_error_unknown_track.error"), .invalid)
        XCTAssertEqual(try classify("csca_error_report_empty.error"), .invalid)
        XCTAssertEqual(CSCAFailure.classify(code: "42501", message: "Learning is unavailable", isTransport: false), .denied)
        XCTAssertEqual(CSCAFailure.classify(code: "22023", message: "learning_test_deadline_passed", isTransport: false), .deadlinePassed)
        XCTAssertEqual(CSCAFailure.classify(code: "22023", message: "learning_report_limit", isTransport: false), .reportLimit)
        XCTAssertEqual(CSCAFailure.classify(code: nil, message: nil, isTransport: true), .network)
        XCTAssertTrue(CSCAFailure.network.isRetryableAsIs)
        XCTAssertFalse(CSCAFailure.conflict.isRetryableAsIs)
    }

    // MARK: Session plan

    func testSessionStages() {
        XCTAssertEqual(CSCASessionPlan.stage(daysToExam: 60, daysToExamEnd: 61), .foundation)
        XCTAssertEqual(CSCASessionPlan.stage(daysToExam: 28, daysToExamEnd: 29), .intensification)
        XCTAssertEqual(CSCASessionPlan.stage(daysToExam: 7, daysToExamEnd: 8), .sprint)
        XCTAssertEqual(CSCASessionPlan.stage(daysToExam: 0, daysToExamEnd: 1), .examDays)
        XCTAssertEqual(CSCASessionPlan.stage(daysToExam: -1, daysToExamEnd: 0), .examDays)
        XCTAssertEqual(CSCASessionPlan.stage(daysToExam: -2, daysToExamEnd: -1), .past)
    }

    func testSessionPlanFromRealCalendar() throws {
        let home = try CSCADecodingTests.decode(CSCAHome.self, "csca_home_after")
        let session = try XCTUnwrap(home.sessions.first { $0.sessionKey == home.targetSessionKey })
        let plan = try XCTUnwrap(CSCASessionPlan.stage(for: session, today: home.today))
        XCTAssertEqual(plan.days, 29)
        XCTAssertEqual(plan.stage, .foundation)
    }

    // MARK: Navigator and report

    func testNavigatorStatesAndFlags() {
        let answers = ["a": "b"]
        XCTAssertEqual(CSCANavigator.state(itemKey: "a", answers: answers, flags: []), .answered)
        XCTAssertEqual(CSCANavigator.state(itemKey: "a", answers: answers, flags: ["a"]), .answeredFlagged)
        XCTAssertEqual(CSCANavigator.state(itemKey: "c", answers: answers, flags: ["c"]), .flagged)
        XCTAssertEqual(CSCANavigator.state(itemKey: "c", answers: answers, flags: []), .empty)
        XCTAssertEqual(CSCANavigator.toggled(["a"], "a"), [])
        XCTAssertEqual(CSCANavigator.toggled(["a"], "b"), ["a", "b"])
    }

    func testReportTextFollowsTheServerRule() {
        XCTAssertNil(CSCAReportText.normalized("   \n  "))
        XCTAssertEqual(CSCAReportText.normalized("  Вариант b\r\nневерно  "), "Вариант b\nневерно")
        XCTAssertNil(CSCAReportText.normalized("tab\there"))
        XCTAssertNil(CSCAReportText.normalized(String(repeating: "я", count: 501)))
        XCTAssertNotNil(CSCAReportText.normalized(String(repeating: "я", count: 500)))
    }

    func testReviewIntervals() {
        XCTAssertEqual((1...4).compactMap(CSCAReviewBoxes.intervalDays(box:)), [1, 3, 7, 14])
        XCTAssertNil(CSCAReviewBoxes.intervalDays(box: 5))
    }
}
