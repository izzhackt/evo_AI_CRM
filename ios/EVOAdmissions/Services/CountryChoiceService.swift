import Foundation
import Supabase

/// Ответ RPC выбора страны не прошёл строгий разбор.
struct CountryChoiceShapeError: Error {}

/// Выбор страны студента (миграция 284, контракт
/// docs/portal/country-timeline-contract.md §4). Те же RPC и имена
/// параметров, что у веба; обе функции только для вошедшего студента о себе.
extension SupabaseService {
    /// `platform.student_country_choice_v1()`: сохранённый выбор или вывод по
    /// умолчанию (`source = none`, страны нет). Ответ не той формы бросает
    /// ошибку, как сбой сети: интерфейс показывает выбор страны и честную
    /// плашку, как веб (`readStudentCountryChoice`).
    func studentCountryChoice() async throws -> StudentCountryChoice {
        let response = try await client
            .rpc("student_country_choice_v1")
            .execute()
        guard let choice = StudentCountryChoice.parse(response.data) else { throw CountryChoiceShapeError() }
        return choice
    }

    /// `platform.set_student_country_choice_v1(p_country, p_request_id)`:
    /// шесть кодов или `UNDECIDED`. Повтор того же `requestId` возвращает
    /// исходную квитанцию. Ответ не той формы или квитанция другой страны
    /// бросают ошибку (как `receipt.country === country` у веба).
    func setStudentCountryChoice(_ attempt: CountryChoiceAttempt) async throws -> StudentCountryChoice {
        struct Params: Encodable, Sendable {
            let p_country: String
            let p_request_id: UUID
        }
        let response = try await client
            .rpc("set_student_country_choice_v1", params: Params(p_country: attempt.country, p_request_id: attempt.requestId))
            .execute()
        guard let choice = StudentCountryChoice.parse(response.data), choice.source == .saved, choice.country == attempt.country else {
            throw CountryChoiceShapeError()
        }
        return choice
    }
}
