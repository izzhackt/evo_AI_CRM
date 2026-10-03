import SwiftUI

// Student-cabinet motion vocabulary, native side. Numbers and rules live in
// `Services/MotionPolicy.swift` (unit-tested, same values as the web portal
// `--pt-motion-*` tokens). Everything here is transform + opacity only, runs
// once, never loops, and degrades under Reduce Motion:
//   - entrances: fade only, no rise, no stagger delay;
//   - press: no scale (the control dims instead);
//   - progress: the fill changes instantly;
//   - wizard/question steps: crossfade instead of a slide;
//   - symbol effects: not played.

/// Shared `Animation` values. One ease-out curve (the web `--pt-ease`), four
/// durations — nothing else in the app should invent its own timing.
enum Motion {
    static func ease(_ duration: TimeInterval) -> Animation {
        .timingCurve(0, 0, 0.2, 1, duration: duration)
    }

    /// Press down/up feedback.
    static let press = ease(MotionPolicy.press)
    /// Tab switch, symbol swap, reduced-motion crossfade.
    static let fast = ease(MotionPolicy.fast)
    /// Wizard step, question change.
    static let base = ease(MotionPolicy.base)
    /// Content entrance, progress fill.
    static let enter = ease(MotionPolicy.slow)
}

// MARK: - Entrance

/// Eases a block in once: opacity 0→1 and a 6 pt rise, optionally delayed for
/// list staggering. With a `key` the entrance plays only the first time that
/// key appears in the app session (`MotionHistory`), so scrolling back, tab
/// revisits and reloads never replay it. Under Reduce Motion it is a plain
/// fade with no rise and no delay.
private struct MotionEntrance: ViewModifier {
    let key: String?
    let delay: TimeInterval
    let enabled: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Bool

    init(key: String?, delay: TimeInterval, enabled: Bool) {
        self.key = key
        self.delay = delay
        self.enabled = enabled
        let alreadyPlayed = key.map { MotionHistory.shared.hasPlayed($0) } ?? false
        _shown = State(initialValue: !enabled || alreadyPlayed)
    }

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : MotionPolicy.entranceOffset)
            .onAppear {
                guard !shown else { return }
                if let key { MotionHistory.shared.claim(key) }
                withAnimation(reduceMotion ? Motion.fast : Motion.enter.delay(delay)) {
                    shown = true
                }
            }
    }
}

extension View {
    /// Eases this block in when it first appears (see `MotionEntrance`).
    /// `key == nil` plays on every new appearance of the view; a key plays once
    /// per app session.
    func motionEntrance(key: String? = nil, delay: TimeInterval = 0) -> some View {
        modifier(MotionEntrance(key: key, delay: delay, enabled: true))
    }

    /// Entrance of the `index`-th card of a list. Only the first
    /// `MotionPolicy.staggerCount` cards animate, each 30 ms after the
    /// previous; any other card (`index == nil`) is left untouched.
    func motionStagger(index: Int?, key: String) -> some View {
        let delay = MotionPolicy.staggerDelay(index: index)
        return modifier(MotionEntrance(key: key, delay: delay ?? 0, enabled: delay != nil))
    }
}

// MARK: - Value-driven change

private struct MotionValueAnimation<Value: Equatable>: ViewModifier {
    let animation: Animation
    let value: Value
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content.animation(reduceMotion ? nil : animation, value: value)
    }
}

extension View {
    /// `.animation(_:value:)` that is switched off under Reduce Motion — for
    /// layout-level changes such as a list row leaving (un-favourite).
    func motionAnimated<Value: Equatable>(
        _ animation: Animation = Motion.base,
        value: Value
    ) -> some View {
        modifier(MotionValueAnimation(animation: animation, value: value))
    }
}

// MARK: - Press

/// Card / option-row press feedback: scale 0.98 over 120 ms. Under Reduce
/// Motion the control dims instead of scaling.
struct PressableButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PressableLabel(configuration: configuration)
    }

    private struct PressableLabel: View {
        let configuration: ButtonStyle.Configuration
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            configuration.label
                .scaleEffect(configuration.isPressed && !reduceMotion ? MotionPolicy.pressScale : 1)
                .opacity(configuration.isPressed && reduceMotion ? 0.7 : 1)
                .animation(Motion.press, value: configuration.isPressed)
        }
    }
}

extension ButtonStyle where Self == PressableButtonStyle {
    static var pressable: PressableButtonStyle { PressableButtonStyle() }
}

// MARK: - Progress

/// Linear progress bar whose fill is a horizontal *scale* from the leading
/// edge — never a frame change — so it animates on the GPU without relayout.
/// Reads to VoiceOver as a percentage, like the system `ProgressView`.
struct MotionProgressBar: View {
    let value: Double
    let total: Double
    var tint: Color = Color("AccentColor")
    /// Fills from empty to `value` when the bar first appears (result screens);
    /// otherwise it starts at `value` and animates only later changes.
    var fillsOnAppear = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var revealed = false

    private var fraction: Double {
        MotionPolicy.progressFraction(value: value, total: total)
    }

    private var shownFraction: Double {
        fillsOnAppear && !revealed ? 0 : fraction
    }

    var body: some View {
        Capsule()
            .fill(Color(.systemGray5))
            .frame(height: 4)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(tint)
                    // 0.001, not 0: a singular transform is ignored by Core Graphics.
                    .scaleEffect(x: max(shownFraction, 0.001), y: 1, anchor: .leading)
                    .animation(reduceMotion ? nil : Motion.enter, value: shownFraction)
            }
            .clipShape(Capsule())
            .onAppear { revealed = true }
            .accessibilityElement(children: .ignore)
            .accessibilityValue(Text(fraction, format: .percent.precision(.fractionLength(0))))
    }
}

// MARK: - Step transitions

private struct StepSlideIn: Transition {
    let direction: StepDirection

    func body(content: Content, phase: TransitionPhase) -> some View {
        content
            .opacity(phase == .willAppear ? 0 : 1)
            .offset(x: phase == .willAppear ? direction.sign * MotionPolicy.stepInOffset : 0)
    }
}

enum MotionTransition {
    /// Wizard step / question change: the new step slides in 20 pt from the
    /// side it is coming from while fading in (200 ms) — from the trailing
    /// side going forward, from the leading side going back. The old step is
    /// removed at once: steps differ in height, and a fading copy of a tall
    /// step would hang over the footer that has already moved up. Reduce
    /// Motion: a 160 ms fade-in, no slide.
    ///
    /// `direction` is the direction of the change that is happening now — set
    /// it before mutating the step, so the render that inserts the new step
    /// already sees it.
    static func step(_ direction: StepDirection, reduceMotion: Bool) -> AnyTransition {
        if reduceMotion {
            return .asymmetric(
                insertion: AnyTransition.opacity.animation(Motion.fast),
                removal: .identity
            )
        }
        return .asymmetric(
            insertion: AnyTransition(StepSlideIn(direction: direction)).animation(Motion.base),
            removal: .identity
        )
    }
}

// MARK: - Symbol effects

private struct MotionBounceOnSet: ViewModifier {
    let isOn: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var tick = 0

    func body(content: Content) -> some View {
        content
            .symbolEffect(.bounce, options: .nonRepeating, value: tick)
            .onChange(of: isOn) { _, now in
                if now && !reduceMotion { tick += 1 }
            }
    }
}

private struct MotionBounceOnAppear: ViewModifier {
    let enabled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var played = false

    func body(content: Content) -> some View {
        content
            .symbolEffect(.bounce, options: .nonRepeating, value: reduceMotion || !enabled ? false : played)
            .onAppear { played = true }
    }
}

private struct MotionSymbolSwap<Trigger: Equatable>: ViewModifier {
    let trigger: Trigger
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace))
            .animation(reduceMotion ? nil : Motion.fast, value: trigger)
    }
}

extension View {
    /// One bounce of the SF Symbol when `isOn` turns on (favourite added,
    /// option selected). Not played under Reduce Motion.
    func motionBounce(whenOn isOn: Bool) -> some View {
        modifier(MotionBounceOnSet(isOn: isOn))
    }

    /// One bounce of the SF Symbol when the view first appears — a success
    /// confirmation (`enabled == false`: none, e.g. a wrong answer). Not
    /// played under Reduce Motion.
    func motionBounceOnAppear(if enabled: Bool = true) -> some View {
        modifier(MotionBounceOnAppear(enabled: enabled))
    }

    /// Animated swap between two SF Symbols (`heart` ⇄ `heart.fill`).
    func motionSymbolSwap<Trigger: Equatable>(on trigger: Trigger) -> some View {
        modifier(MotionSymbolSwap(trigger: trigger))
    }
}
