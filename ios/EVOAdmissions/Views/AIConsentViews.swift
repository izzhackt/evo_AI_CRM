import SwiftUI

/// Согласие на ИИ-помощников (общий контракт 25.10.2026, правило App Store
/// 5.1.2(i)). Два входа к одному `AIConsentModel`: карточка на «Главной» до
/// решения на действующую версию текста и строка в «Профиле», где решение
/// меняется в любой момент. Ничего не блокирует работу в приложении. Тексты
/// RU и KY в `Localizable.xcstrings` (ключи `ai_consent_*`, KY ждёт вычитки
/// носителем).

/// Кнопка ответа. Основная («Разрешить») залита, вторая - с тонированной
/// подложкой; во время отправки подпись для VoiceOver остаётся прежней.
private struct AIConsentActionButton: View {
    @ObservedObject var model: AIConsentModel
    let action: AIConsentAction
    var style: Style = .plain

    enum Style { case prominent, bordered, plain }

    private var isSending: Bool { model.sending == action.status }

    var body: some View {
        let button = Button {
            Task { await model.choose(action.status) }
        } label: {
            Group {
                if isSending {
                    ProgressView()
                } else {
                    Text(LocalizedStringKey(action.labelKey))
                }
            }
            .frame(maxWidth: style == .plain ? nil : .infinity, minHeight: 44)
        }
        .disabled(model.sending != nil)
        .accessibilityLabel(Text(LocalizedStringKey(action.labelKey)))
        .accessibilityIdentifier("ai-consent-\(action.status.rawValue)")
        switch style {
        case .prominent: button.accentProminent()
        case .bordered: button.accentBordered()
        case .plain: button
        }
    }
}

/// Карточка «Главной»: заголовок, текст раскрытия, две кнопки, ссылка на
/// политику. Показывается, пока на действующую версию нет ответа. Сбой
/// чтения не рисует ничего (повтор есть в «Профиле»); если сервер уже
/// обновил текст, а приложение старое, кнопок нет: ответить на текст,
/// которого студент не видел, нельзя.
struct AIConsentCardSection: View {
    @ObservedObject var model: AIConsentModel

    var body: some View {
        if let consent = model.consent, AIConsentPolicy.needsDecision(consent) {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    Text("ai_consent_title")
                        .font(.headline)
                        .accessibilityAddTraits(.isHeader)
                    Text("ai_consent_body")
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                    if AIConsentPolicy.isTextCurrent(consent) {
                        VStack(spacing: 8) {
                            AIConsentActionButton(model: model, action: .allow, style: .prominent)
                            AIConsentActionButton(model: model, action: .decline, style: .bordered)
                        }
                        if model.sendFailed {
                            Text("ai_consent_error")
                                .font(.footnote)
                                .foregroundStyle(.dangerText)
                        }
                    } else {
                        Text("ai_consent_update_app")
                            .font(.footnote)
                            .foregroundStyle(.secondaryText)
                    }
                }
                .padding(.vertical, 4)
                PrivacyPolicyLink()
            }
            .accessibilityIdentifier("ai-consent-card")
        }
    }
}

/// Строка «Профиля»: слово состояния с датой и действия. Показывает свою
/// загрузку и свою ошибку с повтором, чтобы сбой чтения не выглядел как
/// «не выбрано».
struct AIConsentSettingsSection: View {
    @ObservedObject var model: AIConsentModel

    var body: some View {
        Section {
            switch model.phase {
            case .loading:
                ProgressView()
            case .failed:
                VStack(alignment: .leading, spacing: 8) {
                    Text("ai_consent_unavailable")
                        .foregroundStyle(.secondaryText)
                    Button("retry_button") { Task { await model.load() } }
                        .frame(minHeight: 44)
                }
            case .loaded(let consent):
                loadedRows(consent)
            }
        } header: {
            Text("ai_consent_title")
                .foregroundStyle(.secondaryText)
        } footer: {
            Text("ai_consent_body")
                .foregroundStyle(.secondaryText)
        }
    }

    @ViewBuilder
    private func loadedRows(_ consent: AIConsent) -> some View {
        let display = AIConsentPolicy.display(consent)
        LabeledContent {
            Text(stateLine(consent, display: display))
                .foregroundStyle(.secondaryText)
                .multilineTextAlignment(.trailing)
        } label: {
            Text("ai_consent_row_title")
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("ai-consent-state")
        if AIConsentPolicy.isTextCurrent(consent) {
            ForEach(AIConsentPolicy.settingsActions(for: display), id: \.labelKey) { action in
                AIConsentActionButton(model: model, action: action)
            }
            if model.sendFailed {
                Text("ai_consent_error")
                    .font(.footnote)
                    .foregroundStyle(.dangerText)
            }
        } else {
            Text("ai_consent_update_app")
                .font(.footnote)
                .foregroundStyle(.secondaryText)
        }
    }

    private func stateLine(_ consent: AIConsent, display: AIConsentPolicy.Display) -> String {
        let word = Bundle.main.localizedString(forKey: display.stateKey, value: display.stateKey, table: nil)
        guard let date = AIConsentPolicy.dateLabel(consent) else { return word }
        return String(format: String(localized: "ai_consent_state_dated"), word, date)
    }
}
