import Combine
import Foundation

/// Состояние согласия на ИИ-помощников для экранов «Главная» (карточка) и
/// «Профиль» (строка настроек). Один объект на сессию: выбор в настройках
/// сразу убирает или возвращает карточку. Объект живёт в `TabShell`, то есть
/// умирает при выходе, и чужое решение не попадает на экран следующего
/// студента.
///
/// Чтение и запись передаются функциями, поэтому логика проверяется
/// hostless-тестами без Supabase SDK; боевой объект собирает
/// `SupabaseService+AIConsent.swift`.
///
/// Честные состояния: решение считается принятым только после ответа
/// сервера; сбой записи не меняет экран и даёт повтор с тем же `request_id`;
/// сбой фонового обновления не стирает уже показанное решение.
@MainActor
final class AIConsentModel: ObservableObject {
    typealias Load = @Sendable () async throws -> AIConsent
    typealias Save = @Sendable (AIConsentSetParams) async throws -> AIConsent

    enum Phase: Equatable {
        case loading
        case loaded(AIConsent)
        case failed
    }

    @Published private(set) var phase: Phase = .loading
    /// Выбор, который сейчас уходит на сервер.
    @Published private(set) var sending: AIConsentStatus?
    @Published private(set) var sendFailed = false

    private let loadConsent: Load
    private let saveConsent: Save
    private let makeRequestId: () -> UUID
    private var memo = AIConsentRequestMemo()
    /// Растёт с каждым принятым ответом записи: чтение, начатое раньше,
    /// не затирает более новый ответ.
    private var generation = 0
    private var isLoading = false

    init(
        makeRequestId: @escaping () -> UUID = UUID.init,
        load: @escaping Load,
        save: @escaping Save
    ) {
        self.makeRequestId = makeRequestId
        self.loadConsent = load
        self.saveConsent = save
    }

    var consent: AIConsent? {
        if case .loaded(let consent) = phase { return consent }
        return nil
    }

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        if phase == .failed { phase = .loading }
        let startedAt = generation
        do {
            let loaded = try await loadConsent()
            if startedAt == generation { phase = .loaded(loaded) }
        } catch {
            // Уже показанное решение остаётся; пустой экран не выдаём за «не спрашивали».
            // Это верно и при отмене (экран закрыт, пока шло чтение): вызов, пришедший
            // за это время, отброшен `isLoading`, и без решения строка «Профиля»
            // вертела бы индикатор без повтора. Теперь она показывает сбой с повтором.
            if consent == nil { phase = .failed }
        }
    }

    func choose(_ status: AIConsentStatus) async {
        guard sending == nil,
              let current = consent,
              AIConsentPolicy.isTextCurrent(current) else { return }
        sending = status
        sendFailed = false
        let requestId = memo.requestId(for: status, make: makeRequestId)
        var saveFailed = false
        do {
            let receipt = try await saveConsent(AIConsentPolicy.params(for: status, requestId: requestId))
            generation += 1
            memo.settle()
            phase = .loaded(receipt)
        } catch {
            sendFailed = true
            saveFailed = true
        }
        sending = nil
        // Сервер мог сменить версию текста между чтением и записью и отклонить
        // запись: перечитываем, чтобы экран попросил обновить приложение, а не
        // остался с «проверьте интернет». Сбой чтения ничего не стирает.
        if saveFailed { await load() }
    }
}
