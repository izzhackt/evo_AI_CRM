import XCTest

/// Словарь движения кабинета студента (PLAN_CHANGES «2026-10-02 — анимации
/// кабинета студента»): те же значения, что у веб-токенов `--pt-motion-*`,
/// потолок 400 мс, стаггер только для первых карточек, прогресс без деления
/// на ноль, направление шага, «играем один раз за сессию».
final class MotionPolicyTests: XCTestCase {

    // MARK: Токены (паритет с веб-порталом и бюджет времени)

    func testDurationsMatchWebTokens() {
        XCTAssertEqual(MotionPolicy.fast, 0.16, accuracy: 1e-9)   // --pt-motion-fast
        XCTAssertEqual(MotionPolicy.base, 0.20, accuracy: 1e-9)   // --pt-motion
        XCTAssertEqual(MotionPolicy.slow, 0.24, accuracy: 1e-9)   // --pt-motion-slow
    }

    func testEveryDurationIsWithinTheCalmBudget() {
        let all = [
            MotionPolicy.press, MotionPolicy.fast, MotionPolicy.base,
            MotionPolicy.slow,
        ]
        for duration in all {
            XCTAssertGreaterThanOrEqual(duration, 0.10)
            XCTAssertLessThanOrEqual(duration, 0.24)
        }
        XCTAssertLessThanOrEqual(MotionPolicy.ceiling, 0.40)
    }

    func testOffsetsAndPressScaleAreSmall() {
        XCTAssertEqual(MotionPolicy.entranceOffset, 6)
        XCTAssertLessThanOrEqual(MotionPolicy.stepInOffset, 24)
        XCTAssertEqual(MotionPolicy.pressScale, 0.98)
    }

    // MARK: Stagger

    func testStaggerDelayStepsOnlyForTheFirstCards() {
        XCTAssertEqual(MotionPolicy.staggerDelay(index: 0), 0)
        XCTAssertEqual(MotionPolicy.staggerDelay(index: 1) ?? -1, 0.03, accuracy: 1e-9)
        XCTAssertEqual(MotionPolicy.staggerDelay(index: 5) ?? -1, 0.15, accuracy: 1e-9)
        XCTAssertNil(MotionPolicy.staggerDelay(index: 6), "после первых шести — без анимации")
        XCTAssertNil(MotionPolicy.staggerDelay(index: 40))
        XCTAssertNil(MotionPolicy.staggerDelay(index: -1))
        XCTAssertNil(MotionPolicy.staggerDelay(index: nil))
    }

    func testNoEntranceRunsLongerThanTheCeiling() {
        for index in -2...20 {
            XCTAssertLessThanOrEqual(
                MotionPolicy.entranceEnd(index: index), MotionPolicy.ceiling,
                "стаггер + вход не должны превышать 400 мс (index \(index))"
            )
        }
        XCTAssertEqual(MotionPolicy.entranceEnd(index: nil), MotionPolicy.slow, accuracy: 1e-9)
    }

    private struct Row: Identifiable { let id: Int }

    func testStaggerIndexIsBoundedToTheFirstCards() {
        let rows = (0..<50).map(Row.init)
        XCTAssertEqual(MotionPolicy.staggerIndex(of: rows[0], in: rows), 0)
        XCTAssertEqual(MotionPolicy.staggerIndex(of: rows[5], in: rows), 5)
        XCTAssertNil(MotionPolicy.staggerIndex(of: rows[6], in: rows))
        XCTAssertNil(MotionPolicy.staggerIndex(of: Row(id: 999), in: rows))
        XCTAssertNil(MotionPolicy.staggerIndex(of: rows[0], in: []))
    }

    // MARK: Progress

    func testProgressFractionClampsAndNeverDividesByZero() {
        XCTAssertEqual(MotionPolicy.progressFraction(value: 3, total: 9), 1.0 / 3.0, accuracy: 1e-9)
        XCTAssertEqual(MotionPolicy.progressFraction(value: 9, total: 9), 1)
        XCTAssertEqual(MotionPolicy.progressFraction(value: 12, total: 9), 1)
        XCTAssertEqual(MotionPolicy.progressFraction(value: -1, total: 9), 0)
        XCTAssertEqual(MotionPolicy.progressFraction(value: 1, total: 0), 0)
        XCTAssertEqual(MotionPolicy.progressFraction(value: 1, total: -4), 0)
        XCTAssertEqual(MotionPolicy.progressFraction(value: .nan, total: 9), 0)
        XCTAssertEqual(MotionPolicy.progressFraction(value: 1, total: .infinity), 0)
    }

    // MARK: Step direction

    func testStepDirectionFollowsTheIndexChange() {
        XCTAssertEqual(StepDirection(from: 0, to: 1), .forward)
        XCTAssertEqual(StepDirection(from: 4, to: 3), .backward)
        XCTAssertEqual(StepDirection(from: 2, to: 2), .forward)
        XCTAssertEqual(StepDirection.forward.sign, 1)
        XCTAssertEqual(StepDirection.backward.sign, -1)
    }

    // MARK: Entrance history

    func testHistoryClaimsEachKeyOnlyOnce() {
        let history = MotionHistory()
        XCTAssertFalse(history.hasPlayed("home.0"))
        XCTAssertTrue(history.claim("home.0"))
        XCTAssertTrue(history.hasPlayed("home.0"))
        XCTAssertFalse(history.claim("home.0"), "повторный вход играть не должен")
        XCTAssertTrue(history.claim("home.1"))
        history.reset()
        XCTAssertFalse(history.hasPlayed("home.0"))
    }
}
