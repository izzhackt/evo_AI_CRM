import Foundation
import Supabase

/// Согласие на ИИ-помощников (`platform.portal_ai_consent_get_v1()` и
/// `portal_ai_consent_set_v1`, общий контракт 25.10.2026). Обе функции
/// проверяют `auth.uid()` внутри и отдают одно и то же JSONB; ответы
/// сервера и тексты ошибок на экран и в журнал не попадают.
extension SupabaseService {
    func aiConsent() async throws -> AIConsent {
        try await client
            .rpc("portal_ai_consent_get_v1")
            .execute()
            .value
    }

    /// Идемпотентно по `p_request_id`; чужая версия текста и неверный
    /// статус или источник сервер отклоняет.
    func setAIConsent(_ params: AIConsentSetParams) async throws -> AIConsent {
        try await client
            .rpc("portal_ai_consent_set_v1", params: params)
            .execute()
            .value
    }
}

extension AIConsentModel {
    /// Боевой объект: чтение и запись идут через общий клиент приложения.
    static func live() -> AIConsentModel {
        AIConsentModel(
            load: { try await SupabaseService.shared.aiConsent() },
            save: { try await SupabaseService.shared.setAIConsent($0) }
        )
    }
}
