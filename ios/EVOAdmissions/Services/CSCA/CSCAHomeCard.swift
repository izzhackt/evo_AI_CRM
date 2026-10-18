import Foundation

/// Карточка CSCA на «Главной» (решение владельца Q16, 18.10.2026): только для
/// студента, чей выбор страны (`student_country_choice_v1`, миграция 284; тот
/// же выбор, что ведёт «Путь поступления») это Китай. Сохранённый выбор и вывод
/// по умолчанию из анкеты или дела считаются одинаково; для остальных стран,
/// для «Пока не решил», без выбора и при сбое чтения выбора карточки нет.
/// Данные CSCA не загрузились: карточки нет и плашки ошибки нет (раздел
/// «CSCA» показывает свою ошибку сам).
///
/// Правила те же, что у веба (`src/lib/portal/csca-home-card.ts`): ближайшая
/// официальная сессия это первая по дате начала из ещё не закончившихся
/// (последний день экзамена не раньше сегодняшнего дня Бишкека из ответа
/// сервера), а срок «закрывается через N дней» даёт тот же
/// `CSCASessionRegistration`, что экран сессий: только у открытого окна
/// регистрации при N ≤ 60.
enum CSCAHomeCardPolicy {
    /// Код Китая в выборе страны (`study-countries.json`); у веба
    /// `CSCA_HOME_COUNTRY`.
    static let country = "CN"

    /// Показывать ли карточку по выбору страны. nil: выбор не прочитался.
    static func isVisible(_ choice: StudentCountryChoice?) -> Bool {
        choice?.country == country
    }

    /// Ближайшая сессия, которая ещё не закончилась; nil, если будущих нет.
    /// Порядок ответа сервера не важен.
    static func nearestSession(in home: CSCAHome) -> CSCASession? {
        home.sessions
            .filter { $0.examTo >= home.today }
            .min { $0.examFrom < $1.examFrom }
    }

    /// Дней до закрытия окна регистрации сессии: только у открытого окна и
    /// при N ≤ 60; иначе nil (карточка называет одни даты сессии).
    static func closesInDays(for session: CSCASession, in home: CSCAHome) -> Int? {
        CSCASessionRegistration.state(for: session, serverNow: home.serverNow, today: home.today).closesSoon
    }

    /// Одна строка `summary` обзора экзамена на языке интерфейса; nil, если
    /// файл обзора в bundle не разобрался (тест ловит это раньше).
    static func summary(
        _ content: Result<CSCAOverviewContent, CSCAOverviewError> = CSCAOverviewContent.bundled,
        kyrgyz: Bool
    ) -> String? {
        guard case .success(let loaded) = content else { return nil }
        return kyrgyz ? loaded.overview.summary.ky : loaded.overview.summary.ru
    }
}
