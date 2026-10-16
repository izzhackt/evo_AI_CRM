import SwiftUI
import UIKit

/// Test intro: what the test is, its rules, the last result, and the
/// start. «Начать» and «Продолжить» are the same call: the server returns
/// the open draft of this form if there is one (contract §7.1).
struct CSCATestIntroView: View {
    let kind: CSCATestKind

    @EnvironmentObject private var home: CSCAHomeModel
    @State private var attempt: CSCATestAttemptBox?
    @State private var isStarting = false
    @State private var failure: CSCAFailure?
    @State private var startRequestId = UUID()

    var body: some View {
        Group {
            if let test = home.home?.test(kind: kind) {
                content(test)
            } else {
                CSCAFailureView(failure: .invalid, retry: nil)
            }
        }
        .fullScreenCover(item: $attempt, onDismiss: {
            startRequestId = UUID()
            Task { await home.load() }
        }) { box in
            CSCATestRunnerView(start: box.timed)
                .environmentObject(home)
        }
    }

    private func content(_ test: CSCATestSummary) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    Text(verbatim: AppLocale.pick(ru: test.metadata.introRu, ky: test.metadata.introKy))
                        .font(.body)
                    Label {
                        Text(verbatim: CSCAText.f("csca_test_meta", test.itemsTotal, max(1, test.durationSeconds / 60)))
                    } icon: {
                        Image(systemName: "clock")
                    }
                    .font(.subheadline)
                    Label {
                        Text(csca: test.allowEarlyFinish ? "csca_rule_early_ok" : "csca_rule_no_early")
                    } icon: {
                        Image(systemName: test.allowEarlyFinish ? "flag.checkered" : "lock")
                    }
                    .font(.subheadline)
                    Label {
                        Text(csca: "csca_rule_autosave")
                    } icon: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                    .font(.subheadline)
                    Label {
                        Text(csca: "csca_rule_no_calculator")
                    } icon: {
                        Image(systemName: "pencil.and.scribble")
                    }
                    .font(.subheadline)
                }
                .padding(.vertical, 6)
                .foregroundStyle(.primary)
            }

            if let last = test.lastResult {
                Section {
                    NavigationLink(value: CSCARoute.testResult(last.attemptId)) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(verbatim: CSCAText.f("csca_correct_of", last.correctCount, last.itemsTotal))
                                .font(.body.weight(.semibold))
                            Text(verbatim: CSCATime.momentLabel(last.completedAt, locale: AppLocale.current))
                                .font(.subheadline)
                                .foregroundStyle(CSCAColor.secondaryText)
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text(csca: "csca_last_result_header")
                } footer: {
                    Text(csca: "csca_estimate_note")
                }
            }
        }
        .listStyle(.insetGrouped)
        .safeAreaInset(edge: .bottom) {
            VStack(alignment: .leading, spacing: 8) {
                if let failure {
                    Text(csca: CSCAFailureCopy.key(failure))
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.danger)
                }
                if test.draft != nil {
                    Text(csca: "csca_test_draft_note")
                        .font(.footnote)
                        .foregroundStyle(CSCAColor.secondaryText)
                }
                CSCAPrimaryButton(
                    titleKey: test.draft != nil ? "csca_continue" : "csca_start",
                    isWorking: isStarting
                ) {
                    Task { await start(test) }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 8)
            .background(.bar)
        }
        .navigationTitle(Text(verbatim: AppLocale.pick(ru: test.metadata.titleRu, ky: test.metadata.titleKy)))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func start(_ test: CSCATestSummary) async {
        guard !isStarting else { return }
        isStarting = true
        failure = nil
        defer { isStarting = false }
        do {
            let timed = try await SupabaseService.shared.cscaStartTest(formId: test.formId, requestId: startRequestId)
            attempt = CSCATestAttemptBox(timed: timed)
        } catch {
            failure = error.cscaFailure
            if failure != .network { startRequestId = UUID() }
        }
    }
}

struct CSCATestAttemptBox: Identifiable {
    let timed: CSCATimed<CSCATestAttempt>
    var id: UUID { timed.value.attemptId }
}

/// Timed test on the server clock (contract §7). The countdown is display
/// only; the server sets the deadline, refuses late saves and finishes an
/// expired draft. Saves replace the whole state, one request at a time
/// with the latest revision. A mock test has no «Завершить»: when the time
/// is out the client finishes it.
@MainActor
final class CSCATestRunnerModel: ObservableObject {
    enum Phase: Equatable {
        case running
        case finishing
        case completed
        case failed(CSCAFailure)
    }

    @Published private(set) var attempt: CSCATestAttempt
    @Published private(set) var phase: Phase = .running
    @Published private(set) var index = 0
    @Published private(set) var answers: [String: String]
    @Published private(set) var flags: [String]
    @Published private(set) var now = Date()
    @Published private(set) var isSaving = false
    @Published private(set) var saveFailure: CSCAFailure?
    @Published private(set) var lastSavedAt: Date?

    private(set) var clock: CSCAServerClock
    private let deadline: Date
    private var revision: Int64
    private var timer: CSCAItemTimer
    private var dirty = false
    private var lastSaveAt: Date?
    private var ticker: Task<Void, Never>?
    private var completeRequestId = UUID()
    private let service: SupabaseService

    init(start: CSCATimed<CSCATestAttempt>, service: SupabaseService = .shared) {
        self.service = service
        let attempt = start.value
        self.attempt = attempt
        answers = attempt.answers
        flags = attempt.flags
        revision = attempt.revision
        clock = CSCAServerClock(serverNow: attempt.serverNow, receivedAt: start.receivedAt) ?? CSCAServerClock(offset: 0)
        deadline = CSCATime.date(from: attempt.deadlineAt) ?? Date()
        timer = CSCAItemTimer(initial: attempt.itemSeconds)
        if attempt.isCompleted { phase = .completed }
        let firstOpen = attempt.items.firstIndex { attempt.answers[$0.itemKey] == nil } ?? 0
        index = firstOpen
    }

    var items: [CSCAItem] { attempt.items }
    var current: CSCAItem? { items.indices.contains(index) ? items[index] : nil }
    var remaining: TimeInterval { clock.remaining(until: deadline, at: now) }
    var answeredCount: Int { items.filter { answers[$0.itemKey] != nil }.count }
    var isLocked: Bool { phase != .running || remaining <= 0 }

    func begin() {
        guard phase == .running else { return }
        if let current { timer.enter(current.itemKey, at: Date()) }
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self else { return }
                await self.tick()
            }
        }
    }

    func stop() {
        ticker?.cancel()
        ticker = nil
    }

    private func tick() async {
        now = Date()
        guard phase == .running else { return }
        if remaining <= 0 {
            finishInOwnTask()
            return
        }
        await save(.tick)
    }

    /// `finish` stops the ticker, so it must not run inside the ticker's
    /// task: a cancelled task would cancel its own completion request.
    private func finishInOwnTask() {
        Task { [weak self] in await self?.finish(byTimeout: true) }
    }

    // MARK: Answers

    func select(_ optionId: String) {
        guard !isLocked, let current else { return }
        answers[current.itemKey] = optionId
        dirty = true
    }

    func toggleFlag() {
        guard !isLocked, let current else { return }
        flags = CSCANavigator.toggled(flags, current.itemKey)
        dirty = true
    }

    func go(to newIndex: Int) {
        guard items.indices.contains(newIndex), newIndex != index else { return }
        index = newIndex
        timer.enter(items[newIndex].itemKey, at: Date())
        Task { await save(.navigation) }
    }

    func appWillResignActive() {
        timer.pause(at: Date())
        Task { await save(.background) }
    }

    func appDidBecomeActive() {
        now = Date()
        if let current, phase == .running { timer.enter(current.itemKey, at: Date()) }
        Task { await tick() }
    }

    // MARK: Saving (contract §7.3)

    private var saveState: CSCATestSaveState {
        timer.flush(at: Date())
        let keys = Set(items.map(\.itemKey))
        let seconds = timer.seconds.filter { keys.contains($0.key) }.mapValues { max(0, min(3600, $0)) }
        return CSCATestSaveState(answers: answers, flags: flags, itemSeconds: seconds)
    }

    @discardableResult
    func save(_ trigger: CSCASaveSchedule.Trigger) async -> Bool {
        let at = Date()
        if trigger == .tick, dirty == false {
            // Pace hint only: seconds alone are not worth a request.
            return true
        }
        guard CSCASaveSchedule.shouldSave(trigger: trigger, isDirty: dirty, inFlight: isSaving, lastSaveAt: lastSaveAt, now: at) else {
            return !dirty
        }
        guard clock.acceptsSave(deadline: deadline, graceSeconds: attempt.graceSeconds, at: at) else { return false }
        let background = trigger == .background ? UIApplication.shared.beginBackgroundTask(withName: "csca-save") : .invalid
        defer { if background != .invalid { UIApplication.shared.endBackgroundTask(background) } }
        isSaving = true
        defer { isSaving = false }
        let state = saveState
        dirty = false
        do {
            let receipt = try await service.cscaSaveTest(
                attemptId: attempt.attemptId, expectedRevision: revision, state: state, requestId: UUID()
            )
            revision = receipt.value.revision
            if let fresh = CSCAServerClock(serverNow: receipt.value.serverNow, receivedAt: receipt.receivedAt) {
                clock = fresh
            }
            lastSaveAt = at
            lastSavedAt = Date()
            saveFailure = nil
            if state.answers != answers || state.flags != flags { dirty = true }
            return true
        } catch {
            dirty = true
            let failure = error.cscaFailure
            switch failure {
            case .conflict:
                // Another save landed first: take its revision, keep this
                // device's answers and send them again on the next save.
                if let fresh = try? await service.cscaTestAttempt(attemptId: attempt.attemptId) {
                    if fresh.value.isCompleted {
                        adoptCompleted(fresh.value)
                        return false
                    }
                    revision = fresh.value.revision
                }
                saveFailure = nil
            case .deadlinePassed, .testCompleted:
                finishInOwnTask()
            default:
                saveFailure = failure
            }
            lastSaveAt = at
            return false
        }
    }

    // MARK: Finish (contract §7.4)

    var canFinishEarly: Bool { attempt.allowEarlyFinish && phase == .running }

    func finish(byTimeout: Bool) async {
        guard phase == .running || phase == .failed(.network) else { return }
        phase = .finishing
        stop()
        timer.pause(at: Date())
        // Let a save already in flight land first, then send what is left.
        while isSaving { try? await Task.sleep(for: .milliseconds(100)) }
        if dirty {
            _ = await save(.deadline)
        }
        for _ in 0..<30 {
            do {
                let timed = try await service.cscaCompleteTest(
                    attemptId: attempt.attemptId, expectedRevision: revision, requestId: completeRequestId
                )
                adoptCompleted(timed.value)
                return
            } catch {
                switch error.cscaFailure {
                case .earlyFinishForbidden:
                    // The device clock ran ahead of the server: wait for it.
                    try? await Task.sleep(for: .seconds(1))
                case .conflict, .testCompleted:
                    if let fresh = try? await service.cscaTestAttempt(attemptId: attempt.attemptId) {
                        if fresh.value.isCompleted {
                            adoptCompleted(fresh.value)
                            return
                        }
                        revision = fresh.value.revision
                    }
                    completeRequestId = UUID()
                case .network:
                    phase = .failed(.network)
                    return
                default:
                    phase = .failed(error.cscaFailure)
                    return
                }
            }
        }
        phase = .failed(.network)
    }

    private func adoptCompleted(_ completed: CSCATestAttempt) {
        stop()
        attempt = completed
        answers = completed.answers
        flags = completed.flags
        phase = .completed
    }
}

struct CSCATestRunnerView: View {
    @StateObject private var model: CSCATestRunnerModel
    @EnvironmentObject private var home: CSCAHomeModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var showsNavigator = false
    @State private var confirmExit = false
    @State private var confirmFinish = false

    init(start: CSCATimed<CSCATestAttempt>) {
        _model = StateObject(wrappedValue: CSCATestRunnerModel(start: start))
    }

    var body: some View {
        NavigationStack {
            Group {
                switch model.phase {
                case .completed:
                    CSCATestResultView(attempt: model.attempt)
                case .finishing:
                    VStack(spacing: 14) {
                        ProgressView()
                        Text(csca: model.remaining <= 0 ? "csca_time_up_sending" : "csca_sending")
                            .font(.body)
                            .multilineTextAlignment(.center)
                    }
                    .padding(32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .failed(let failure):
                    VStack(spacing: 12) {
                        CSCAFailureView(failure: failure, retry: nil)
                        if failure == .network {
                            CSCAPrimaryButton(titleKey: "csca_retry_send") {
                                Task { await model.finish(byTimeout: true) }
                            }
                            .padding(.horizontal, 32)
                        }
                    }
                case .running:
                    running
                }
            }
            .toolbar { toolbar }
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: CSCARoute.self) { route in
                if case .review = route { CSCAReviewView().environmentObject(home) }
            }
        }
        .interactiveDismissDisabled(true)
        .onAppear { model.begin() }
        .onDisappear { model.stop() }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background, .inactive: model.appWillResignActive()
            case .active: model.appDidBecomeActive()
            @unknown default: break
            }
        }
        .sheet(isPresented: $showsNavigator) {
            CSCANavigatorSheet(model: model) { target in
                showsNavigator = false
                model.go(to: target)
            } finish: {
                showsNavigator = false
                confirmFinish = true
            }
            .presentationDetents([.medium, .large])
        }
        .confirmationDialog(Text(csca: "csca_exit_title"), isPresented: $confirmExit, titleVisibility: .visible) {
            Button(role: .destructive) {
                Task {
                    await model.save(.background)
                    dismiss()
                }
            } label: { Text(csca: "csca_exit_confirm") }
            Button(role: .cancel) {} label: { Text(csca: "csca_exit_stay") }
        } message: {
            Text(csca: "csca_exit_message")
        }
        .confirmationDialog(Text(csca: "csca_finish_title"), isPresented: $confirmFinish, titleVisibility: .visible) {
            Button {
                Task { await model.finish(byTimeout: false) }
            } label: { Text(csca: "csca_finish_confirm") }
            Button(role: .cancel) {} label: { Text(csca: "csca_exit_stay") }
        } message: {
            Text(verbatim: CSCAText.f("csca_finish_message", model.answeredCount, model.items.count))
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            if model.phase == .completed {
                Button { dismiss() } label: { Text(csca: "csca_done") }
            } else if model.phase == .running {
                Button { confirmExit = true } label: { Text(csca: "csca_close") }
            }
        }
        if model.phase == .running {
            ToolbarItem(placement: .principal) {
                Text(verbatim: CSCAText.f("csca_item_counter", model.index + 1, model.items.count))
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            ToolbarItem(placement: .primaryAction) {
                CSCATimerLabel(remaining: model.remaining)
            }
        }
    }

    private var running: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let item = model.current {
                    CSCAItemStem(item: item, figure: item.figureKey.flatMap { model.attempt.figures[$0] })
                    CSCAOptionList(
                        options: item.options,
                        selected: model.answers[item.itemKey],
                        correctOptionId: nil,
                        isEnabled: !model.isLocked
                    ) { id in
                        model.select(id)
                    }
                    saveStatus
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
            .frame(maxWidth: 680, alignment: .leading)
            .frame(maxWidth: .infinity)
            .id(model.index)
        }
        .background(Color(.systemBackground))
        .safeAreaInset(edge: .bottom) { bottomBar }
        .cscaReadingColumn()
    }

    @ViewBuilder
    private var saveStatus: some View {
        if let failure = model.saveFailure {
            Label {
                Text(csca: failure == .network ? "csca_save_offline" : CSCAFailureCopy.key(failure))
            } icon: {
                Image(systemName: "exclamationmark.triangle")
            }
            .font(.footnote)
            .foregroundStyle(CSCAColor.danger)
        } else {
            Text(csca: "csca_rule_autosave")
                .font(.footnote)
                .foregroundStyle(CSCAColor.secondaryText)
        }
    }

    private var bottomBar: some View {
        let isFlagged = model.current.map { model.flags.contains($0.itemKey) } ?? false
        let isLast = model.index >= model.items.count - 1
        return HStack(spacing: 4) {
            Button {
                model.go(to: model.index - 1)
            } label: {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.semibold))
                    .frame(width: 44, height: 44)
            }
            .disabled(model.index == 0)
            .accessibilityLabel(Text(csca: "csca_previous"))

            Button {
                model.toggleFlag()
            } label: {
                Label {
                    Text(csca: "csca_flag")
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                        .minimumScaleFactor(0.8)
                } icon: {
                    Image(systemName: isFlagged ? "flag.fill" : "flag")
                }
                .font(.subheadline.weight(.medium))
                .frame(minHeight: 44)
            }
            .tint(isFlagged ? CSCAColor.accentText : .primary)
            .accessibilityAddTraits(isFlagged ? .isSelected : [])

            Spacer(minLength: 0)

            Button {
                showsNavigator = true
            } label: {
                Image(systemName: "square.grid.3x3")
                    .font(.body.weight(.semibold))
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(Text(csca: "csca_navigator"))

            Button {
                if isLast { showsNavigator = true } else { model.go(to: model.index + 1) }
            } label: {
                Text(csca: isLast ? "csca_overview" : "csca_next")
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(CSCAColor.accent)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
        .tint(CSCAColor.accent)
    }
}

/// «Осталось mm:ss», monospaced digits; red in the last minute. VoiceOver
/// gets whole minutes, not a new label every second.
struct CSCATimerLabel: View {
    let remaining: TimeInterval
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let low = remaining <= 60
        Label {
            Text(verbatim: CSCACountdown.label(remaining))
                .monospacedDigit()
                .fixedSize()
        } icon: {
            Image(systemName: "clock")
        }
        .labelStyle(CSCATimerLabelStyle(showsIcon: !dynamicTypeSize.isAccessibilitySize))
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(low ? CSCAColor.danger : .primary)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: CSCAText.f("csca_time_left_a11y", Int((remaining / 60).rounded(.up)))))
    }
}

/// The countdown never truncates: at accessibility sizes the clock icon
/// goes away first.
private struct CSCATimerLabelStyle: LabelStyle {
    let showsIcon: Bool

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            if showsIcon { configuration.icon }
            configuration.title
        }
    }
}

private struct CSCANavigatorSheet: View {
    @ObservedObject var model: CSCATestRunnerModel
    let go: (Int) -> Void
    let finish: () -> Void

    private let columns = [GridItem(.adaptive(minimum: 52), spacing: 10)]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(verbatim: CSCAText.f("csca_navigator_summary", model.answeredCount, model.items.count, model.flags.count))
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.secondaryText)
                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                            cell(index, item)
                        }
                    }
                    legend
                    if model.canFinishEarly {
                        CSCAPrimaryButton(titleKey: "csca_finish_test", action: finish)
                    } else {
                        Text(csca: "csca_rule_no_early")
                            .font(.footnote)
                            .foregroundStyle(CSCAColor.secondaryText)
                    }
                }
                .padding(20)
            }
            .navigationTitle(Text(csca: "csca_navigator"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    CSCATimerLabel(remaining: model.remaining)
                }
            }
        }
    }

    private func cell(_ index: Int, _ item: CSCAItem) -> some View {
        let state = CSCANavigator.state(itemKey: item.itemKey, answers: model.answers, flags: model.flags)
        let answered = state == .answered || state == .answeredFlagged
        let flagged = state == .flagged || state == .answeredFlagged
        let isCurrent = index == model.index
        return Button {
            go(index)
        } label: {
            ZStack(alignment: .topTrailing) {
                Text(verbatim: "\(index + 1)")
                    .font(.body.weight(.semibold).monospacedDigit())
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .foregroundStyle(answered ? Color.white : Color.primary)
                    .background(
                        RoundedRectangle(cornerRadius: 10)
                            .fill(answered ? CSCAColor.accent : Color(.secondarySystemBackground))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(isCurrent ? Color.primary : Color.clear, lineWidth: 2)
                    )
                if flagged {
                    Image(systemName: "flag.fill")
                        .font(.caption2)
                        .foregroundStyle(answered ? Color.white : CSCAColor.accent)
                        .padding(5)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: cellLabel(index, answered: answered, flagged: flagged)))
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }

    private func cellLabel(_ index: Int, answered: Bool, flagged: Bool) -> String {
        var parts = [CSCAText.f("csca_item_number", index + 1)]
        parts.append(CSCAText.t(answered ? "csca_cell_answered" : "csca_cell_open"))
        if flagged { parts.append(CSCAText.t("csca_flag")) }
        return parts.joined(separator: ", ")
    }

    private var legend: some View {
        HStack(spacing: 16) {
            Label {
                Text(csca: "csca_cell_answered")
            } icon: {
                RoundedRectangle(cornerRadius: 4).fill(CSCAColor.accent).frame(width: 16, height: 16)
            }
            Label {
                Text(csca: "csca_flag")
            } icon: {
                Image(systemName: "flag.fill").foregroundStyle(CSCAColor.accent)
            }
        }
        .font(.footnote)
        .foregroundStyle(CSCAColor.secondaryText)
        .accessibilityHidden(true)
    }
}
