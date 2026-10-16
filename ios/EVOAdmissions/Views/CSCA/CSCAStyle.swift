import SwiftUI
import UIKit

/// Strings of the CSCA screens live in their own String Catalog table
/// (`Resources/CSCA.xcstrings`), RU base and KY (KY marked for native
/// proofreading in the catalog).
enum CSCAText {
    static let table = "CSCA"

    static func t(_ key: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, comment: "")
    }

    /// Format string from the table; plural variations resolve here.
    static func f(_ key: String, _ args: CVarArg...) -> String {
        String(format: t(key), locale: AppLocale.current, arguments: args)
    }

    static func pick(_ pair: CSCABilingual) -> String {
        AppLocale.pick(ru: pair.ru, ky: pair.ky)
    }

    /// «Заданий: 30. Время: 7 мин 30 с», whole minutes without seconds,
    /// like the web `durationLabel`.
    static func testMeta(itemsTotal: Int, durationSeconds: Int) -> String {
        let minutes = durationSeconds / 60
        let seconds = durationSeconds % 60
        return seconds == 0
            ? f("csca_test_meta", itemsTotal, minutes)
            : f("csca_test_meta_seconds", itemsTotal, minutes, seconds)
    }
}

extension Text {
    /// A key of the CSCA table.
    init(csca key: String) {
        self.init(LocalizedStringKey(key), tableName: CSCAText.table)
    }
}

/// Colours of the CSCA screens. Text colours come from the portal palette
/// (the same six roles as the figures), with contrast of at least 4.5:1 on
/// the system grouped backgrounds in both appearances.
enum CSCAColor {
    private static func dynamic(light: String, dark: String) -> Color {
        Color(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            let (r, g, b) = CSCAPaletteRole.components(hex)
            return UIColor(red: r, green: g, blue: b, alpha: 1)
        })
    }

    static let secondaryText = dynamic(light: "#5f5a54", dark: "#b3ada4")
    static let ok = dynamic(light: CSCAPaletteRole.ok.lightHex, dark: CSCAPaletteRole.ok.darkHex)
    static let danger = dynamic(light: "#c00215", dark: CSCAPaletteRole.accent.darkHex)
    static let accent = Color("AccentColor")
    /// Red for text and outlined controls: the palette accent, lighter in
    /// dark mode so text keeps at least 4.5:1 (filled buttons use `accent`).
    static let accentText = dynamic(light: CSCAPaletteRole.accent.lightHex, dark: CSCAPaletteRole.accent.darkHex)
    static let okFill = dynamic(light: "#e6f2eb", dark: "#183326")
    static let dangerFill = dynamic(light: "#fbe6e8", dark: "#3a1d20")
    static let selectedFill = dynamic(light: "#f3e7e2", dark: "#33292a")
    /// Panels on a reading page (system background).
    static let panel = Color(.secondarySystemBackground)
    static let page = Color(.systemGroupedBackground)
    static let hairline = Color(.separator)

    static func figure(_ role: CSCAPaletteRole, dark: Bool) -> Color {
        let (r, g, b) = CSCAPaletteRole.components(dark ? role.darkHex : role.lightHex)
        return Color(red: r, green: g, blue: b)
    }
}

/// Topic state word with a symbol that is never the only signal.
struct CSCAStateBadge: View {
    let state: CSCATopicState

    var body: some View {
        Label {
            Text(csca: Self.labelKey(state))
        } icon: {
            Image(systemName: Self.symbol(state))
                .foregroundStyle(Self.tint(state))
        }
        .font(.footnote.weight(.medium))
        .labelStyle(.titleAndIcon)
        .foregroundStyle(CSCAColor.secondaryText)
    }

    static func labelKey(_ state: CSCATopicState) -> String {
        switch state {
        case .notStarted: return "csca_state_not_started"
        case .fewData: return "csca_state_few_data"
        case .gap: return "csca_state_gap"
        case .shaky: return "csca_state_shaky"
        case .confident: return "csca_state_confident"
        }
    }

    static func symbol(_ state: CSCATopicState) -> String {
        switch state {
        case .notStarted: return "circle"
        case .fewData: return "circle.dotted"
        case .gap: return "exclamationmark.circle.fill"
        case .shaky: return "circle.lefthalf.filled"
        case .confident: return "checkmark.circle.fill"
        }
    }

    static func tint(_ state: CSCATopicState) -> Color {
        switch state {
        case .notStarted, .fewData: return CSCAColor.secondaryText
        case .gap: return CSCAColor.danger
        case .shaky: return .primary
        case .confident: return CSCAColor.ok
        }
    }
}

/// Section heading inside a reading screen.
struct CSCAHeading: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.title3.weight(.semibold))
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// Honest load failure with the one action that can help.
struct CSCAFailureView: View {
    let failure: CSCAFailure
    let retry: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: failure == .denied ? "lock" : "wifi.exclamationmark")
                .font(.title)
                .foregroundStyle(CSCAColor.secondaryText)
                .accessibilityHidden(true)
            Text(csca: CSCAFailureCopy.key(failure))
                .font(.body)
                .multilineTextAlignment(.center)
            if failure != .denied, let retry {
                Button(action: retry) {
                    Text(csca: "csca_retry")
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(CSCAColor.accentText)
            }
        }
        .padding(32)
        .frame(maxWidth: .infinity)
    }
}

enum CSCAFailureCopy {
    static func key(_ failure: CSCAFailure) -> String {
        switch failure {
        case .network: return "csca_error_network"
        case .conflict: return "csca_error_conflict"
        case .denied: return "csca_error_denied"
        case .deadlinePassed: return "csca_error_deadline"
        case .testCompleted: return "csca_error_test_completed"
        case .earlyFinishForbidden: return "csca_error_early_finish"
        case .reviewNotDue: return "csca_error_review_not_due"
        case .reportLimit: return "csca_error_report_limit"
        case .alreadyAnswered: return "csca_error_already_answered"
        case .invalid: return "csca_error_invalid"
        }
    }
}

/// Primary full-width action, 50 pt tall, with a spinner while working.
struct CSCAPrimaryButton: View {
    let titleKey: String
    var isWorking = false
    var isEnabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Text(csca: titleKey).opacity(isWorking ? 0 : 1)
                if isWorking { ProgressView().tint(.white) }
            }
            .font(.body.weight(.semibold))
            .frame(maxWidth: .infinity, minHeight: 50)
        }
        .buttonStyle(.borderedProminent)
        .tint(CSCAColor.accent)
        .disabled(!isEnabled || isWorking)
        .accessibilityLabel(Text(csca: titleKey))
    }
}
