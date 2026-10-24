import Foundation

/// Согласие студента на ИИ-помощников (решение владельца 25.10.2026, правило
/// App Store 5.1.2(i): явное разрешение в приложении до передачи личных
/// данных стороннему ИИ). Контракт общий для веба, iPhone и CRM:
/// `platform.portal_ai_consent_get_v1()` и
/// `platform.portal_ai_consent_set_v1(p_status, p_policy_version, p_source,
/// p_request_id)`, оба отдают один и тот же JSONB
/// `{status, policyVersion, decidedAt, currentPolicyVersion}`.
///
/// Файл без SwiftUI и Supabase SDK: входит в hostless-тесты.

/// Решение студента. Нет решения (`status` = null) - «не спрашивали».
enum AIConsentStatus: String, Equatable, Sendable, CaseIterable {
    case granted
    case declined
}

/// Ответ обеих RPC. Время остаётся строкой (см. `PostgresTimestamp`).
/// Неизвестное значение `status` не разбирается: экран не угадывает, что
/// разрешено, и честно говорит «не удалось загрузить».
struct AIConsent: Decodable, Equatable, Sendable {
    let status: AIConsentStatus?
    /// Версия текста, на которую студент ответил; null без решения.
    let policyVersion: String?
    /// timestamptz, отрендеренный в JSONB; null без решения.
    let decidedAt: String?
    /// Версия текста, действующая на сервере сейчас.
    let currentPolicyVersion: String

    private enum CodingKeys: String, CodingKey {
        case status, policyVersion, decidedAt, currentPolicyVersion
    }

    init(status: AIConsentStatus?, policyVersion: String?, decidedAt: String?, currentPolicyVersion: String) {
        self.status = status
        self.policyVersion = policyVersion
        self.decidedAt = decidedAt
        self.currentPolicyVersion = currentPolicyVersion
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let raw = try container.decodeIfPresent(String.self, forKey: .status) {
            guard let parsed = AIConsentStatus(rawValue: raw) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .status, in: container, debugDescription: "unknown AI consent status"
                )
            }
            status = parsed
        } else {
            status = nil
        }
        policyVersion = try container.decodeIfPresent(String.self, forKey: .policyVersion)
        decidedAt = try container.decodeIfPresent(String.self, forKey: .decidedAt)
        currentPolicyVersion = try container.decode(String.self, forKey: .currentPolicyVersion)
    }
}

/// Параметры `portal_ai_consent_set_v1`. Имена ключей - имена параметров
/// функции, их проверяет тест.
struct AIConsentSetParams: Encodable, Equatable, Sendable {
    let p_status: String
    let p_policy_version: String
    let p_source: String
    let p_request_id: UUID
}

/// Действие студента. Подпись кнопки зависит от того, что уже выбрано:
/// «Не разрешать» до выбора и «Отозвать согласие» после разрешения - один и
/// тот же ответ `declined`.
enum AIConsentAction: Equatable, Sendable {
    case allow
    case decline
    case revoke

    var status: AIConsentStatus {
        switch self {
        case .allow: return .granted
        case .decline, .revoke: return .declined
        }
    }

    /// Ключ каталога `Localizable.xcstrings` (RU и KY).
    var labelKey: String {
        switch self {
        case .allow: return "ai_consent_allow"
        case .decline: return "ai_consent_decline"
        case .revoke: return "ai_consent_revoke"
        }
    }
}

enum AIConsentPolicy {
    /// Версия текста согласия, который показывает эта сборка
    /// (`AI_CONSENT_POLICY_VERSION` контракта). Уходит в `p_policy_version`:
    /// студент отвечает на ровно тот текст, который видел.
    static let policyVersion = "2026-10-25"
    /// Значение `p_source` для приложения (`portal_web` | `ios`).
    static let source = "ios"

    /// Кому приложение предлагает согласие (решение владельца 25.10.2026, то же
    /// правило, что в веб-кабинете): только студенту с делом EVO. ИИ-помощники
    /// работают с перепиской и документами дела, которые ведут сотрудники;
    /// у самостоятельного студента (дело в состоянии `pending`, уровень
    /// `approved`, куратора нет) этого материала нет, поэтому спрашивать
    /// нечего. Уровень берётся из существующего состояния дела
    /// (`StudentPortalCase.accessTier`), второго признака нет.
    static func isOffered(to tier: AccessTier) -> Bool {
        tier == .assisted
    }

    /// Что студент видит в настройках. Считается по тому, что реально
    /// происходит на сервере: помощники читают документы и переписку только
    /// при «разрешено» на действующую версию; «не разрешено» они уважают при
    /// любой версии; остальное для них то же, что «не выбрано».
    enum Display: Equatable, Sendable {
        case granted
        case declined
        case notChosen

        /// Ключ слова состояния в каталоге.
        var stateKey: String {
            switch self {
            case .granted: return "ai_consent_state_granted"
            case .declined: return "ai_consent_state_declined"
            case .notChosen: return "ai_consent_state_unset"
            }
        }
    }

    static func display(_ consent: AIConsent) -> Display {
        switch consent.status {
        case .declined?:
            return .declined
        case .granted? where consent.policyVersion == consent.currentPolicyVersion:
            return .granted
        default:
            return .notChosen
        }
    }

    /// Решение принято на действующую версию текста. Пока его нет, на
    /// «Главной» стоит карточка (не блокирует ничего).
    static func isDecidedOnCurrentVersion(_ consent: AIConsent) -> Bool {
        consent.status != nil && consent.policyVersion == consent.currentPolicyVersion
    }

    static func needsDecision(_ consent: AIConsent) -> Bool {
        !isDecidedOnCurrentVersion(consent)
    }

    /// Эта сборка показывает именно тот текст, что действует на сервере.
    /// Иначе (сервер уже обновил текст, а приложение старое) выбрать нельзя:
    /// сервер отклонит чужую версию, а студент не видел новый текст.
    static func isTextCurrent(_ consent: AIConsent) -> Bool {
        consent.currentPolicyVersion == policyVersion
    }

    /// Действия строки настроек для текущего состояния.
    static func settingsActions(for display: Display) -> [AIConsentAction] {
        switch display {
        case .granted: return [.revoke]
        case .declined: return [.allow]
        case .notChosen: return [.allow, .decline]
        }
    }

    /// Действия карточки «Главной»: ответ на текст, а не отзыв.
    static let cardActions: [AIConsentAction] = [.allow, .decline]

    /// Дата решения для слова состояния: день по Бишкеку, как в разделе
    /// удаления аккаунта. Без решения или с нечитаемым временем даты нет.
    static func dateLabel(_ consent: AIConsent) -> String? {
        guard display(consent) != .notChosen, let raw = consent.decidedAt else { return nil }
        return AccountDeletionPolicy.dayLabel(from: raw)
    }

    static func params(for status: AIConsentStatus, requestId: UUID) -> AIConsentSetParams {
        AIConsentSetParams(
            p_status: status.rawValue,
            p_policy_version: policyVersion,
            p_source: source,
            p_request_id: requestId
        )
    }
}

/// Идемпотентный повтор: пока ответ сервера на выбор не получен, тот же выбор
/// уходит с тем же `request_id` (потерянный ответ не создаст второе решение,
/// сервер вернёт прежний ответ). Другой выбор или принятый ответ начинают
/// новый запрос.
struct AIConsentRequestMemo: Equatable, Sendable {
    private struct Pending: Equatable, Sendable {
        let status: AIConsentStatus
        let requestId: UUID
    }

    private var pending: Pending?

    init() {}

    mutating func requestId(for status: AIConsentStatus, make: () -> UUID = UUID.init) -> UUID {
        if let pending, pending.status == status { return pending.requestId }
        let fresh = make()
        pending = Pending(status: status, requestId: fresh)
        return fresh
    }

    /// Сервер ответил: следующее решение получит новый `request_id`.
    mutating func settle() {
        pending = nil
    }
}
