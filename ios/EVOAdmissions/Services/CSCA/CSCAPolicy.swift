import Foundation

/// Pure CSCA client rules (no UI, no network), unit-tested headlessly:
/// timestamps, the server clock for timed tests, the batched-save schedule,
/// failure classification and the session plan.

// MARK: - Timestamps and Bishkek dates

enum CSCATime {
    /// Postgres `timestamptz` inside JSONB with its fraction kept (the
    /// shared `PostgresTimestamp` drops it): the test clock needs
    /// sub-second offsets.
    static func date(from raw: String) -> Date? {
        guard let whole = PostgresTimestamp.date(from: raw) else { return nil }
        guard let dot = raw.firstIndex(of: ".") else { return whole }
        var end = raw.index(after: dot)
        while end < raw.endIndex, raw[end].isNumber { end = raw.index(after: end) }
        let fraction = Double("0" + raw[dot..<end]) ?? 0
        return whole.addingTimeInterval(fraction)
    }

    static let bishkek = TimeZone(identifier: "Asia/Bishkek")!

    /// `…On` and `today` values are Bishkek calendar dates `YYYY-MM-DD`.
    static func day(from raw: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = bishkek
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: raw)
    }

    /// Whole days from `from` to `to` (both Bishkek dates).
    static func daysBetween(_ from: String, _ to: String) -> Int? {
        guard let a = day(from: from), let b = day(from: to) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = bishkek
        return calendar.dateComponents([.day], from: a, to: b).day
    }

    static func dayLabel(_ raw: String, locale: Locale) -> String {
        guard let date = day(from: raw) else { return raw }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = bishkek
        formatter.setLocalizedDateFormatFromTemplate("d MMMM")
        return formatter.string(from: date)
    }

    static func dayWithYearLabel(_ raw: String, locale: Locale) -> String {
        guard let date = day(from: raw) else { return raw }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = bishkek
        formatter.setLocalizedDateFormatFromTemplate("d MMMM yyyy")
        return formatter.string(from: date)
    }

    /// A `timestamptz` shown in Bishkek time, like every portal timestamp.
    static func momentLabel(_ raw: String, locale: Locale) -> String {
        guard let date = date(from: raw) else { return raw }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = bishkek
        formatter.setLocalizedDateFormatFromTemplate("d MMMM HH:mm")
        return formatter.string(from: date)
    }
}

// MARK: - Server clock (contract §7.2)

/// Seconds on `ContinuousClock`: it keeps counting while the phone sleeps
/// and does not move when the student changes the device time, so the test
/// countdown, the save schedule and the item timer cannot jump.
enum CSCAMonotonic {
    private static let origin = ContinuousClock.now

    static func now() -> TimeInterval {
        let elapsed = origin.duration(to: ContinuousClock.now).components
        return TimeInterval(elapsed.seconds) + TimeInterval(elapsed.attoseconds) / 1e18
    }
}

/// Server time anchored to the monotonic clock: `serverNow` of a response
/// and the `CSCAMonotonic` reading when it arrived. Server time later is
/// that `serverNow` plus the monotonic seconds since, never the device
/// wall clock. The server alone decides the deadline; this is display only
/// and is re-anchored on every response that carries `serverNow`.
struct CSCAServerClock: Equatable {
    let serverAtAnchor: Date
    let anchor: TimeInterval
    /// false only for the device stand-in, which any server anchor replaces.
    let isFromServer: Bool

    init(serverAtAnchor: Date, anchor: TimeInterval, isFromServer: Bool = true) {
        self.serverAtAnchor = serverAtAnchor
        self.anchor = anchor
        self.isFromServer = isFromServer
    }

    init?(serverNow raw: String, receivedAt anchor: TimeInterval) {
        guard let server = CSCATime.date(from: raw) else { return nil }
        self.init(serverAtAnchor: server, anchor: anchor)
    }

    /// Without a readable `serverNow` the device clock stands in.
    static func device() -> CSCAServerClock {
        CSCAServerClock(serverAtAnchor: Date(), anchor: CSCAMonotonic.now(), isFromServer: false)
    }

    func serverTime(at monotonic: TimeInterval) -> Date {
        serverAtAnchor.addingTimeInterval(monotonic - anchor)
    }

    /// The clock to keep when a save receipt brings a new anchor. A replay
    /// of a save the server already took (same `p_request_id`) returns its
    /// first receipt, with the `serverNow` of that moment; anchoring on it
    /// would wind the countdown back by the time between the two sends.
    /// Every anchor trails the real server time by its response's trip, so
    /// the later estimate is the better one. Both run on the same monotonic
    /// seconds, so comparing them at one instant decides it.
    func keepingLater(_ other: CSCAServerClock) -> CSCAServerClock {
        guard isFromServer else { return other }
        let at = max(anchor, other.anchor)
        return other.serverTime(at: at) > serverTime(at: at) ? other : self
    }

    /// Seconds left until `deadline`, never negative.
    func remaining(until deadline: Date, at monotonic: TimeInterval) -> TimeInterval {
        max(0, deadline.timeIntervalSince(serverTime(at: monotonic)))
    }

    /// Whether a save would still be accepted: before deadline + grace.
    func acceptsSave(deadline: Date, graceSeconds: Int, at monotonic: TimeInterval) -> Bool {
        serverTime(at: monotonic) < deadline.addingTimeInterval(TimeInterval(graceSeconds))
    }
}

enum CSCACountdown {
    /// «41:07», or «1:00:00» from one hour; rounds up so 0:00 shows only
    /// when time is really out.
    static func label(_ remaining: TimeInterval) -> String {
        let total = Int(remaining.rounded(.up))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, seconds)
        }
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

// MARK: - Batched save schedule (contract §7.3)

/// When the runner sends `save_learning_test_v1`: a batch every 10 s while
/// something changed, on moving between items not more often than every
/// 2 s, and always when the app goes to the background. Requests run one
/// at a time with the latest revision. Times are `CSCAMonotonic` seconds.
struct CSCASaveSchedule {
    static let batchInterval: TimeInterval = 10
    static let navigationInterval: TimeInterval = 2

    enum Trigger: Equatable {
        case tick
        case navigation
        case background
        case deadline
    }

    static func shouldSave(
        trigger: Trigger,
        isDirty: Bool,
        inFlight: Bool,
        lastSaveAt: TimeInterval?,
        now: TimeInterval
    ) -> Bool {
        guard isDirty, !inFlight else { return false }
        let since = lastSaveAt.map { now - $0 } ?? .infinity
        switch trigger {
        case .tick: return since >= batchInterval
        case .navigation: return since >= navigationInterval
        case .background, .deadline: return true
        }
    }
}

/// One `save_learning_test_v1` request. After a transport failure it is
/// resent unchanged, same request id, revision and state (contract §1):
/// if the first one landed, the server returns the same receipt.
struct CSCAFrozenTestSave: Equatable {
    let requestId: UUID
    let revision: Int64
    let state: CSCATestSaveState
}

/// What the test runner still has to send. A request lost in transit is
/// resent as it was, so it does not carry the answers given after it. When
/// it lands those are still unsaved and go out in a fresh request within
/// the same save, as on the web: finishing or leaving never stops at the
/// frozen state.
struct CSCASaveQueue: Equatable {
    /// Requests one save sends in a row at most: the frozen retry, the
    /// current state, and one more for a change made while they were sent.
    static let maxRequestsPerSave = 3

    private(set) var retry: CSCAFrozenTestSave?
    private(set) var isDirty = false

    var hasUnsaved: Bool { isDirty || retry != nil }

    /// An answer, flag or time changed on this device.
    mutating func changed() { isDirty = true }

    /// The request to send now: the frozen retry first, else the current
    /// state, which from then on counts as sent.
    mutating func next(revision: Int64, state: () -> CSCATestSaveState) -> CSCAFrozenTestSave {
        if let retry { return retry }
        isDirty = false
        return CSCAFrozenTestSave(requestId: UUID(), revision: revision, state: state())
    }

    /// The server took it; anything changed after `next` is still unsaved.
    mutating func landed() { retry = nil }

    /// No answer: the server may have stored it, so resend this very request.
    mutating func lostInTransit(_ request: CSCAFrozenTestSave) { retry = request }

    /// The server will not take this request again (conflict, deadline,
    /// finished test): do not resend it.
    mutating func dropRetry() { retry = nil }

    /// Refused outright: what it carried is unsaved again.
    mutating func refused() {
        retry = nil
        isDirty = true
    }

    /// The server attempt replaced this device's state.
    mutating func clear() {
        retry = nil
        isDirty = false
    }
}

/// Seconds spent on each item, added to the server's `item_seconds` hint
/// (pace for the student only, clamped 0..3600 like the server). Times are
/// `CSCAMonotonic` seconds.
struct CSCAItemTimer: Equatable {
    private(set) var seconds: [String: Int]
    private(set) var currentKey: String?
    private(set) var enteredAt: TimeInterval?

    init(initial: [String: Int]) {
        seconds = initial
    }

    mutating func enter(_ key: String, at now: TimeInterval) {
        flush(at: now)
        currentKey = key
        enteredAt = now
    }

    mutating func flush(at now: TimeInterval) {
        guard let key = currentKey, let start = enteredAt else { return }
        let spent = Int((now - start).rounded())
        if spent > 0 {
            seconds[key] = min(3600, (seconds[key] ?? 0) + spent)
        }
        enteredAt = now
    }

    mutating func pause(at now: TimeInterval) {
        flush(at: now)
        enteredAt = nil
    }
}

// MARK: - Failures (contract §1.1)

enum CSCAFailure: Equatable {
    case network
    case conflict             // 40001: re-read and retry
    case denied               // 42501: learning unavailable
    case deadlinePassed       // learning_test_deadline_passed
    case testCompleted        // learning_test_completed
    case earlyFinishForbidden // learning_test_early_finish_forbidden
    case reviewNotDue         // learning_review_not_due
    case reportLimit          // learning_report_limit
    case alreadyAnswered      // second answer to a lesson exercise
    case invalid              // any other 22023: a client bug

    static func classify(code: String?, message: String?, isTransport: Bool) -> CSCAFailure {
        switch code {
        case "40001": return .conflict
        case "42501": return .denied
        case "22023":
            switch message {
            case "learning_test_deadline_passed": return .deadlinePassed
            case "learning_test_completed": return .testCompleted
            case "learning_test_early_finish_forbidden": return .earlyFinishForbidden
            case "learning_review_not_due": return .reviewNotDue
            case "learning_report_limit": return .reportLimit
            case "Learning exercise is already answered": return .alreadyAnswered
            default: return .invalid
            }
        case .some: return .invalid
        case nil: return isTransport ? .network : .invalid
        }
    }

    /// Repeating the same frozen request (same request id, same input) is
    /// safe only after a transport failure.
    var isRetryableAsIs: Bool { self == .network }
}

// MARK: - Session plan (contract §11)

/// Countdown and the three stages counted on the client from `examFrom`:
/// foundation, then weak topics with timed items, then full mock tests.
/// The boundaries are an EVO rule of thumb (the CSC guide puts the sprint
/// about a week before the session), not an official schedule.
enum CSCASessionPlan {
    enum Stage: Equatable {
        case foundation
        case intensification
        case sprint
        case examDays
        case past
    }

    static let sprintDays = 7
    static let intensificationDays = 28

    static func stage(daysToExam: Int, daysToExamEnd: Int) -> Stage {
        if daysToExamEnd < 0 { return .past }
        if daysToExam <= 0 { return .examDays }
        if daysToExam <= sprintDays { return .sprint }
        if daysToExam <= intensificationDays { return .intensification }
        return .foundation
    }

    static func stage(for session: CSCASession, today: String) -> (days: Int, stage: Stage)? {
        guard let days = CSCATime.daysBetween(today, session.examFrom),
              let toEnd = CSCATime.daysBetween(today, session.examTo) else { return nil }
        return (days, stage(daysToExam: days, daysToExamEnd: toEnd))
    }
}

// MARK: - Review boxes (contract §8)

enum CSCAReviewBoxes {
    /// Days until the next repetition for each box.
    static func intervalDays(box: Int) -> Int? {
        switch box {
        case 1: return 1
        case 2: return 3
        case 3: return 7
        case 4: return 14
        default: return nil
        }
    }
}

// MARK: - Test navigator

enum CSCANavigatorCellState: Equatable {
    case empty
    case answered
    case flagged
    case answeredFlagged
}

enum CSCANavigator {
    static func state(itemKey: String, answers: [String: String], flags: [String]) -> CSCANavigatorCellState {
        let answered = answers[itemKey] != nil
        let flagged = flags.contains(itemKey)
        switch (answered, flagged) {
        case (true, true): return .answeredFlagged
        case (true, false): return .answered
        case (false, true): return .flagged
        case (false, false): return .empty
        }
    }

    /// Flag toggle that keeps the array free of duplicates (contract §7.3).
    static func toggled(_ flags: [String], _ key: String) -> [String] {
        flags.contains(key) ? flags.filter { $0 != key } : flags + [key]
    }
}

// MARK: - Report text (contract §10)

enum CSCAReportText {
    static let maxLength = 500

    /// The message the server will accept (285 `report_learning_item_v1`):
    /// 1..500 characters (`char_length`, so Unicode scalars) after trimming,
    /// and no control character except the line feed. Carriage returns
    /// become line feeds first. nil when the text cannot be sent.
    static func normalized(_ raw: String) -> String? {
        let unified = raw
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        let trimmed = unified.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.unicodeScalars.count <= maxLength else { return nil }
        let forbidden = trimmed.unicodeScalars.contains { scalar in
            let value = scalar.value
            return (value >= 0x01 && value <= 0x09) || (value >= 0x0B && value <= 0x1F) || value == 0x7F
        }
        return forbidden ? nil : trimmed
    }

    static func length(_ raw: String) -> Int {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.count
    }
}
