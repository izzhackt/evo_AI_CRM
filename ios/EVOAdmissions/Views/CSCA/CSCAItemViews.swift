import SwiftUI

/// Building blocks of an item card shared by the lesson check, practice,
/// mistakes and the test review: English stem with its figure, the four
/// options, the explanation of every option, the solution step by step and
/// «Сообщить об ошибке». The answer key exists on the client only inside an
/// explain that the server returned for an answered item.

struct CSCAItemStem: View {
    let item: CSCAItem
    let figure: CSCAFigure?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            CSCAMathText(source: item.stemEn, style: .body, weight: .medium, isEnglish: true)
                .environment(\.locale, Locale(identifier: "en"))
            if let figure {
                CSCAFigureView(figure: figure)
            }
        }
    }
}

enum CSCAOptionOutcome: Equatable {
    case correct        // the key, chosen or not
    case wrongChoice    // chosen and wrong
    case neutral
}

/// Four options as one list of full-width rows (each at least 44 pt).
struct CSCAOptionList: View {
    @ScaledMetric(relativeTo: .subheadline) private var letterSize: CGFloat = 28
    let options: [CSCAOption]
    let selected: String?
    /// nil while answering; set once a verdict exists.
    let correctOptionId: String?
    var isEnabled = true
    let onSelect: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                if index > 0 { Divider().padding(.leading, letterSize + 24) }
                row(option)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(CSCAColor.hairline, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func outcome(_ id: String) -> CSCAOptionOutcome {
        guard let key = correctOptionId else { return .neutral }
        if id == key { return .correct }
        if id == selected { return .wrongChoice }
        return .neutral
    }

    @ViewBuilder
    private func row(_ option: CSCAOption) -> some View {
        let isSelected = selected == option.id
        let result = outcome(option.id)
        if correctOptionId != nil {
            // Answered: a read-only list, not dimmed like a disabled control.
            rowLabel(option, isSelected: isSelected, result: result)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(accessibilityLabel(option, outcome: result))
                .accessibilityAddTraits(isSelected ? .isSelected : [])
        } else {
            Button {
                onSelect(option.id)
            } label: {
                rowLabel(option, isSelected: isSelected, result: result)
            }
            .buttonStyle(.plain)
            .disabled(!isEnabled)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityLabel(option, outcome: result))
            .accessibilityAddTraits(isSelected ? .isSelected : [])
        }
    }

    private func rowLabel(_ option: CSCAOption, isSelected: Bool, result: CSCAOptionOutcome) -> some View {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                letter(option.id, isSelected: isSelected, outcome: result)
                CSCAMathText(source: option.label, style: .body, isEnglish: true)
                    .environment(\.locale, Locale(identifier: "en"))
                if result == .correct {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(CSCAColor.ok)
                        .accessibilityHidden(true)
                } else if result == .wrongChoice {
                    Image(systemName: "xmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(CSCAColor.danger)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .background(background(isSelected: isSelected, outcome: result))
            .contentShape(Rectangle())
    }

    private func letter(_ id: String, isSelected: Bool, outcome: CSCAOptionOutcome) -> some View {
        let filled = isSelected || outcome == .correct
        // Solid fills under the white letter in both appearances.
        let tint: Color = outcome == .correct
            ? CSCAColor.okSolid
            : (outcome == .wrongChoice ? CSCAColor.dangerSolid : CSCAColor.accentFill)
        return Text(verbatim: id.uppercased())
            .font(.subheadline.weight(.semibold))
            .frame(width: letterSize, height: letterSize)
            .foregroundStyle(filled ? Color.white : Color.primary)
            .background(Circle().fill(filled ? tint : Color.clear))
            .overlay(Circle().strokeBorder(filled ? Color.clear : CSCAColor.hairline, lineWidth: 1.5))
            .accessibilityHidden(true)
    }

    private func background(isSelected: Bool, outcome: CSCAOptionOutcome) -> Color {
        switch outcome {
        case .correct: return CSCAColor.okFill
        case .wrongChoice: return CSCAColor.dangerFill
        case .neutral: return isSelected ? CSCAColor.selectedFill : Color.clear
        }
    }

    /// «Вариант A» and the verdict in the app language, the option itself
    /// (English content and formulas) in English.
    private func accessibilityLabel(_ option: CSCAOption, outcome: CSCAOptionOutcome) -> Text {
        var label = AttributedString(CSCAText.f("csca_option_letter", option.id.uppercased()) + " ")
        label += CSCASpeech.mixed(option.label, textIsEnglish: true)
        switch outcome {
        case .correct: label += AttributedString(". " + CSCAText.t("csca_option_is_correct"))
        case .wrongChoice: label += AttributedString(". " + CSCAText.t("csca_option_your_wrong"))
        case .neutral: break
        }
        return Text(label)
    }
}

/// Verdict line: «Верно» or «Неверно», word plus symbol.
struct CSCAVerdictLine: View {
    let correct: Bool
    var answered = true

    var body: some View {
        Label {
            Text(csca: !answered ? "csca_verdict_unanswered" : (correct ? "csca_verdict_correct" : "csca_verdict_wrong"))
                .font(.headline)
        } icon: {
            Image(systemName: !answered ? "minus.circle.fill" : (correct ? "checkmark.circle.fill" : "xmark.circle.fill"))
        }
        .foregroundStyle(!answered ? CSCAColor.secondaryText : (correct ? CSCAColor.ok : CSCAColor.danger))
        .symbolEffect(.bounce, value: correct)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Explanation of an answered item: the chosen and the correct option
/// first, the other options on request, then the solution step by step
/// («Следующий шаг», «Показать решение») and the terms.
struct CSCAExplainView: View {
    let item: CSCAItem
    let explain: CSCAItemExplain
    let selected: String?

    @State private var showsAllOptions = false
    @State private var stepsShown = 0

    private var solution: [String] { AppLocale.isKyrgyz ? explain.solutionKy : explain.solutionRu }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(primaryIds, id: \.self) { id in
                optionExplain(id)
            }
            if !secondaryIds.isEmpty {
                if showsAllOptions {
                    ForEach(secondaryIds, id: \.self) { id in
                        optionExplain(id)
                    }
                } else {
                    Button {
                        withAnimation(Motion.base) { showsAllOptions = true }
                    } label: {
                        Text(csca: "csca_explain_all_options")
                            .frame(minHeight: 44)
                    }
                    .tint(CSCAColor.accentText)
                }
            }

            if !solution.isEmpty {
                Divider()
                Text(csca: "csca_solution")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                ForEach(Array(solution.prefix(stepsShown).enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text(verbatim: "\(index + 1).")
                            .font(.body.monospacedDigit())
                            .foregroundStyle(CSCAColor.secondaryText)
                            .accessibilityHidden(true)
                        CSCAMathText(source: step)
                    }
                    .transition(.opacity)
                }
                if stepsShown < solution.count {
                    CSCAStepButtons {
                        withAnimation(Motion.base) { stepsShown += 1 }
                    } all: {
                        withAnimation(Motion.base) { stepsShown = solution.count }
                    }
                }
            }

            if !explain.terms.isEmpty {
                CSCATermsList(terms: explain.terms)
            }
        }
    }

    private var primaryIds: [String] {
        var ids: [String] = []
        if let selected { ids.append(selected) }
        if !ids.contains(explain.correctOptionId) { ids.append(explain.correctOptionId) }
        return ids
    }

    private var secondaryIds: [String] {
        CSCAItem.optionIds.filter { !primaryIds.contains($0) }
    }

    private func optionExplain(_ id: String) -> some View {
        let text = explain.explain(for: id).map { AppLocale.pick(ru: $0.explainRu, ky: $0.explainKy) } ?? ""
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(verbatim: id.uppercased())
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(id == explain.correctOptionId ? CSCAColor.ok : CSCAColor.secondaryText)
                .frame(width: 18, alignment: .leading)
                .accessibilityHidden(true)
            CSCAMathText(source: text, style: .callout)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(
            AttributedString(CSCAText.f("csca_option_letter", id.uppercased()) + ". ")
                + CSCASpeech.mixed(text, textIsEnglish: false)
        ))
    }
}

/// «Следующий шаг» and «Показать решение» side by side, stacked when the
/// line is too narrow (small screens, large text).
struct CSCAStepButtons: View {
    let next: () -> Void
    let all: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { buttons }
            VStack(alignment: .leading, spacing: 4) { buttons }
        }
        .tint(CSCAColor.accentText)
    }

    @ViewBuilder
    private var buttons: some View {
        Button(action: next) {
            Text(csca: "csca_next_step_button")
                .fixedSize()
                .frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        Button(action: all) {
            Text(csca: "csca_show_solution")
                .fixedSize()
                .frame(minHeight: 44)
        }
        .buttonStyle(.borderless)
    }
}

struct CSCATermsList: View {
    let terms: [CSCATerm]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(csca: "csca_terms")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            ForEach(terms, id: \.self) { term in
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: term.en)
                        .font(.body.weight(.semibold))
                        .environment(\.locale, Locale(identifier: "en"))
                    Text(verbatim: AppLocale.pick(ru: term.ru, ky: term.ky))
                        .font(.subheadline)
                        .foregroundStyle(CSCAColor.secondaryText)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(
                    CSCASpeech.english(term.en) + AttributedString(", " + AppLocale.pick(ru: term.ru, ky: term.ky))
                ))
            }
        }
    }
}

/// «Сообщить об ошибке» link and its sheet (contract §10).
struct CSCAReportButton: View {
    let itemKey: String
    @State private var isPresented = false

    var body: some View {
        Button {
            isPresented = true
        } label: {
            Label {
                Text(csca: "csca_report_button")
            } icon: {
                Image(systemName: "exclamationmark.bubble")
            }
            .font(.subheadline)
            .frame(minHeight: 44)
        }
        .tint(CSCAColor.secondaryText)
        .sheet(isPresented: $isPresented) {
            CSCAReportSheet(itemKey: itemKey)
        }
    }
}

@MainActor
final class CSCAReportModel: ObservableObject {
    @Published var text = ""
    @Published private(set) var isSending = false
    @Published private(set) var failure: CSCAFailure?
    @Published private(set) var sent = false

    let itemKey: String
    private let service: SupabaseService
    /// Frozen for a retry after a network error: same id, same message.
    private var pending: (id: UUID, message: String)?

    init(itemKey: String, service: SupabaseService = .shared) {
        self.itemKey = itemKey
        self.service = service
    }

    var canSend: Bool { CSCAReportText.normalized(text) != nil && !isSending }

    func send() async {
        guard !isSending else { return }
        let request: (id: UUID, message: String)
        if let pending, pending.message == CSCAReportText.normalized(text) {
            request = pending
        } else {
            guard let message = CSCAReportText.normalized(text) else { return }
            request = (UUID(), message)
        }
        pending = request
        isSending = true
        failure = nil
        defer { isSending = false }
        do {
            _ = try await service.cscaReportItem(itemKey: itemKey, message: request.message, requestId: request.id)
            sent = true
            pending = nil
        } catch {
            failure = error.cscaFailure
            if failure != .network { pending = nil }
        }
    }
}

struct CSCAReportSheet: View {
    @StateObject private var model: CSCAReportModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focused: Bool

    init(itemKey: String) {
        _model = StateObject(wrappedValue: CSCAReportModel(itemKey: itemKey))
    }

    var body: some View {
        NavigationStack {
            Form {
                if model.sent {
                    Section {
                        Label {
                            Text(csca: "csca_report_sent")
                        } icon: {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(CSCAColor.ok)
                        }
                    }
                } else {
                    Section {
                        TextEditor(text: $model.text)
                            .frame(minHeight: 140)
                            .focused($focused)
                            .accessibilityLabel(Text(csca: "csca_report_field"))
                    } header: {
                        Text(csca: "csca_report_field")
                    } footer: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(verbatim: CSCAText.f("csca_report_counter", CSCAReportText.length(model.text), CSCAReportText.maxLength))
                                .monospacedDigit()
                                .foregroundStyle(CSCAReportText.length(model.text) > CSCAReportText.maxLength ? CSCAColor.danger : CSCAColor.secondaryText)
                            Text(csca: "csca_report_privacy")
                        }
                    }
                    if let failure = model.failure {
                        Section {
                            Text(csca: failure == .invalid ? "csca_report_invalid" : CSCAFailureCopy.key(failure))
                                .foregroundStyle(CSCAColor.danger)
                        }
                    }
                }
            }
            .navigationTitle(Text(csca: "csca_report_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        Text(csca: model.sent ? "csca_done" : "csca_cancel")
                    }
                }
                if !model.sent {
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            Task { await model.send() }
                        } label: {
                            if model.isSending { ProgressView() } else { Text(csca: "csca_report_send") }
                        }
                        .disabled(!model.canSend)
                    }
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(model.isSending)
    }
}
