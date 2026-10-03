import Foundation

/// Motion vocabulary of the student cabinet — numbers and rules only, no
/// SwiftUI, so they are unit-tested in the hostless bundle and stay identical
/// to the web portal tokens (`--pt-motion-fast` 160 ms, `--pt-motion` 200 ms,
/// `--pt-motion-slow` 240 ms, `--pt-ease` cubic-bezier(0, 0, 0.2, 1) in
/// `src/app/(portal)/portal.css`).
///
/// Principles (PLAN_CHANGES «2026-10-02 — анимации кабинета студента»):
/// purposeful and calm; 100–300 ms; nothing above 400 ms end to end (this
/// ceiling covers the `Motion.*` animations; system SF Symbol effects keep
/// their own ~0.4–0.5 s duration);
/// ease-out only; transform and opacity only (progress is a scale, not a frame
/// change); nothing loops; every motion is removed or reduced under Reduce
/// Motion. The SwiftUI side lives in `Views/Motion.swift`.
enum MotionPolicy {
    /// Press feedback on cards and option rows.
    static let press: TimeInterval = 0.12
    /// Small state changes: tab switch, symbol swap, crossfade.
    static let fast: TimeInterval = 0.16
    /// Routine transitions: wizard step, question change.
    static let base: TimeInterval = 0.20
    /// Content entrance and progress fill — the longest single motion.
    static let slow: TimeInterval = 0.24
    /// Hard ceiling for any sequence (delay + duration).
    static let ceiling: TimeInterval = 0.40

    /// Vertical rise of an entering block (pt).
    static let entranceOffset: Double = 6
    /// Horizontal travel of an entering wizard/question step (pt).
    static let stepInOffset: Double = 20
    /// Scale of a pressed card.
    static let pressScale: Double = 0.98

    /// Delay between consecutive cards of one list.
    static let staggerStep: TimeInterval = 0.03
    /// Only the first cards of a list stagger — the rest appear as usual.
    static let staggerCount = 6

    /// Entrance delay of the card at `index`, or `nil` when that card must not
    /// animate (no index, negative, or beyond the first `staggerCount`).
    static func staggerDelay(index: Int?) -> TimeInterval? {
        guard let index, index >= 0, index < staggerCount else { return nil }
        return Double(index) * staggerStep
    }

    /// Longest an entrance can run: stagger delay plus the entrance itself.
    static func entranceEnd(index: Int?) -> TimeInterval {
        (staggerDelay(index: index) ?? 0) + slow
    }

    /// Fill fraction of a progress bar, clamped to 0…1; a zero or invalid
    /// total is an empty bar, never a division by zero.
    static func progressFraction(value: Double, total: Double) -> Double {
        guard total > 0, value.isFinite, total.isFinite else { return 0 }
        return min(max(value / total, 0), 1)
    }

    /// Index of `item` among the first `staggerCount` of `items`, else `nil`.
    /// Bounded scan (at most `staggerCount` comparisons), so it is safe to
    /// call from every row of a long list.
    static func staggerIndex<Item: Identifiable>(of item: Item, in items: [Item]) -> Int? {
        items.prefix(staggerCount).firstIndex { $0.id == item.id }
    }
}

/// Direction of a step change in a multi-step flow (anketa wizard, test
/// questions). `forward` enters from the trailing side, `backward` from the
/// leading side.
enum StepDirection: Equatable {
    case forward
    case backward

    init(from: Int, to: Int) {
        self = to >= from ? .forward : .backward
    }

    /// +1 forward, −1 backward — multiplies a horizontal offset.
    var sign: Double { self == .forward ? 1 : -1 }
}

/// Entrance keys already played in this app session. A card that has eased in
/// once appears instantly afterwards (scrolled back, tab revisited, list
/// reloaded), so motion is a first-impression cue, never a repeat tax.
final class MotionHistory {
    static let shared = MotionHistory()

    private let lock = NSLock()
    private var played: Set<String> = []

    func hasPlayed(_ key: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return played.contains(key)
    }

    /// Marks `key` as played; `true` only the first time.
    @discardableResult
    func claim(_ key: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return played.insert(key).inserted
    }

    func reset() {
        lock.lock()
        defer { lock.unlock() }
        played.removeAll()
    }
}
