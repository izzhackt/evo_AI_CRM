import XCTest

/// Карточка CSCA на «Главной» (Q16, 18.10.2026): видна только при выбранном
/// Китае, ближайшая сессия и срок регистрации по тем же правилам, что у веба
/// (`tests/portal-csca-home-card.test.mjs`), без плашки ошибки. Данные: настоящие
/// ответы `learning_track_home_v1` с демо-стенда (16.10.2026, сессия 2026-11
/// с окном регистрации до 21.10 по Бишкеку).
final class CSCAHomeCardTests: XCTestCase {
    private static let iosRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    private static let appSources = iosRoot.appendingPathComponent("EVOAdmissions")

    private func choice(_ json: String) -> StudentCountryChoice? {
        StudentCountryChoice.parse(Data(json.utf8))
    }

    /// Главная трека на 16.10.2026 с правкой: другой «сегодня», окно, сессии.
    private func home(_ edit: (inout [String: Any]) -> Void = { _ in }) throws -> CSCAHome {
        try CSCADecodingTests.mutated(CSCAHome.self, "csca_home_fresh", edit)
    }

    private func source(_ path: String) throws -> String {
        try String(contentsOf: Self.appSources.appendingPathComponent(path), encoding: .utf8)
    }

    // MARK: Видимость по выбору страны

    func testOnlyChinaShowsTheCardWhetherSavedOrDefault() throws {
        XCTAssertEqual(CSCAHomeCardPolicy.country, "CN")
        XCTAssertTrue(StudentCountryChoice.countryCodes.contains(CSCAHomeCardPolicy.country))
        // Сохранённый выбор, вывод из анкеты и из дела одинаково дают карточку.
        XCTAssertTrue(CSCAHomeCardPolicy.isVisible(choice(#"{"country":"CN","source":"saved","savedAt":"2026-10-18T05:00:00+00:00"}"#)))
        XCTAssertTrue(CSCAHomeCardPolicy.isVisible(choice(#"{"country":"CN","source":"application","savedAt":null}"#)))
        XCTAssertTrue(CSCAHomeCardPolicy.isVisible(choice(#"{"country":"CN","source":"case","savedAt":null}"#)))
        // Остальные пять стран, «Пока не решил», нет выбора, выбор не прочитался.
        for code in StudentCountryChoice.countryCodes where code != "CN" {
            XCTAssertFalse(CSCAHomeCardPolicy.isVisible(choice(#"{"country":"\#(code)","source":"saved","savedAt":"2026-10-18T05:00:00+00:00"}"#)), code)
            XCTAssertFalse(CSCAHomeCardPolicy.isVisible(choice(#"{"country":"\#(code)","source":"application","savedAt":null}"#)), code)
            XCTAssertFalse(CSCAHomeCardPolicy.isVisible(choice(#"{"country":"\#(code)","source":"case","savedAt":null}"#)), code)
        }
        XCTAssertFalse(CSCAHomeCardPolicy.isVisible(choice(#"{"country":"UNDECIDED","source":"saved","savedAt":"2026-10-18T05:00:00+00:00"}"#)))
        XCTAssertFalse(CSCAHomeCardPolicy.isVisible(choice(#"{"country":null,"source":"none","savedAt":null}"#)))
        XCTAssertFalse(CSCAHomeCardPolicy.isVisible(nil))
        // Код сравнивается точно; такие ответы разбор отвергает ещё раньше.
        XCTAssertNil(choice(#"{"country":"cn","source":"saved","savedAt":"2026-10-18T05:00:00+00:00"}"#))
        XCTAssertFalse(CSCAHomeCardPolicy.isVisible(StudentCountryChoice(country: " CN", source: .saved, savedAt: nil)))
    }

    // MARK: Ближайшая сессия

    func testNearestSessionSkipsFinishedOnesAndSurvivesHavingNone() throws {
        let fresh = try home()
        XCTAssertEqual(fresh.sessions.map(\.sessionKey), ["2026-11", "2026-12", "2027-01", "2027-03", "2027-04", "2027-06"])
        XCTAssertEqual(CSCAHomeCardPolicy.nearestSession(in: fresh)?.sessionKey, "2026-11")
        // Последний день экзамена ещё идёт: сессия остаётся ближайшей.
        XCTAssertEqual(CSCAHomeCardPolicy.nearestSession(in: try home { $0["today"] = "2026-11-15" })?.sessionKey, "2026-11")
        XCTAssertEqual(CSCAHomeCardPolicy.nearestSession(in: try home { $0["today"] = "2026-11-16" })?.sessionKey, "2026-12")
        XCTAssertNil(CSCAHomeCardPolicy.nearestSession(in: try home { $0["today"] = "2027-06-28" }))
        // Порядок ответа сервера не важен: по дате начала.
        let reversed = try home { object in
            object["today"] = "2026-12-21"
            object["sessions"] = Array(((object["sessions"] as? [[String: Any]]) ?? []).reversed())
        }
        XCTAssertEqual(CSCAHomeCardPolicy.nearestSession(in: reversed)?.sessionKey, "2027-01")
        XCTAssertNil(CSCAHomeCardPolicy.nearestSession(in: try home { $0["sessions"] = [[String: Any]]() }))
    }

    // MARK: Срок регистрации

    func testClosesInOnlyForAnOpenWindowOfSixtyDaysOrLess() throws {
        let fresh = try home()
        let session = try XCTUnwrap(CSCAHomeCardPolicy.nearestSession(in: fresh))
        // 16.10 → окно закрывается 21.10 по Бишкеку (23:59 по Пекину): пять дней.
        XCTAssertEqual(CSCAHomeCardPolicy.closesInDays(for: session, in: fresh), 5)
        // В день закрытия: «закрывается сегодня» (0 дней).
        let lastDay = try home { $0["serverNow"] = "2026-10-21T10:00:00+00:00"; $0["today"] = "2026-10-21" }
        XCTAssertEqual(CSCAHomeCardPolicy.closesInDays(for: try XCTUnwrap(CSCAHomeCardPolicy.nearestSession(in: lastDay)), in: lastDay), 0)
        // Окно закрыто: даты сессии без срока.
        let closed = try home { $0["serverNow"] = "2026-10-22T10:00:00+00:00"; $0["today"] = "2026-10-22" }
        let closedSession = try XCTUnwrap(CSCAHomeCardPolicy.nearestSession(in: closed))
        XCTAssertEqual(closedSession.sessionKey, "2026-11")
        XCTAssertNil(CSCAHomeCardPolicy.closesInDays(for: closedSession, in: closed))
        // Ещё не открылось и не опубликовано.
        let upcoming = try home { object in
            var sessions = (object["sessions"] as? [[String: Any]]) ?? []
            sessions[0]["registrationOpensAt"] = "2026-10-20T07:00:00+00:00"
            object["sessions"] = sessions
        }
        XCTAssertNil(CSCAHomeCardPolicy.closesInDays(for: try XCTUnwrap(CSCAHomeCardPolicy.nearestSession(in: upcoming)), in: upcoming))
        let unpublished = try home { object in
            var sessions = (object["sessions"] as? [[String: Any]]) ?? []
            sessions[0]["registrationOpensAt"] = NSNull()
            sessions[0]["registrationClosesAt"] = NSNull()
            object["sessions"] = sessions
        }
        XCTAssertNil(CSCAHomeCardPolicy.closesInDays(for: try XCTUnwrap(CSCAHomeCardPolicy.nearestSession(in: unpublished)), in: unpublished))
        // Больше 60 дней до закрытия: срок не обещаем.
        let far = try home { object in
            var sessions = (object["sessions"] as? [[String: Any]]) ?? []
            sessions[0]["registrationClosesAt"] = "2027-01-30T15:59:00+00:00"
            object["sessions"] = sessions
        }
        XCTAssertNil(CSCAHomeCardPolicy.closesInDays(for: try XCTUnwrap(CSCAHomeCardPolicy.nearestSession(in: far)), in: far))
    }

    // MARK: Строка обзора и тексты

    func testTheSummaryIsTheOverviewLineUntouched() throws {
        let content = CSCAOverviewContent.bundled
        guard case .success(let loaded) = content else { return XCTFail("the bundled overview must parse") }
        XCTAssertEqual(CSCAHomeCardPolicy.summary(content, kyrgyz: false), loaded.overview.summary.ru)
        XCTAssertEqual(CSCAHomeCardPolicy.summary(content, kyrgyz: true), loaded.overview.summary.ky)
        XCTAssertTrue(loaded.overview.summary.ru.hasPrefix("Нужен для бакалавриата в 306 вузах CSC."))
        // Файл не разобрался: строки нет (карточка остаётся без неё), а не выдуманный текст.
        XCTAssertNil(CSCAHomeCardPolicy.summary(.failure(CSCAOverviewError(file: "overview.json", path: "$", reason: "test")), kyrgyz: false))
    }

    func testCardStringsExistInRussianAndKyrgyzWithoutDashes() throws {
        let bundle = Bundle(for: CSCAHomeCardTests.self)
        for language in ["ru", "ky"] {
            let path = try XCTUnwrap(bundle.path(forResource: "CSCA", ofType: "strings", inDirectory: nil, forLocalization: language))
            let table = try XCTUnwrap(NSDictionary(contentsOfFile: path) as? [String: String])
            for key in ["csca_home_card_session", "csca_home_card_registration", "csca_home_card_action"] {
                let value = try XCTUnwrap(table[key], "\(language) \(key)")
                XCTAssertFalse(value.isEmpty, "\(language) \(key)")
                XCTAssertFalse(value.contains("\u{2014}") || value.contains("\u{2013}"), "\(language) \(key)")
            }
            XCTAssertTrue(try XCTUnwrap(table["csca_home_card_session"]).contains("%@"), language)
            XCTAssertTrue(try XCTUnwrap(table["csca_home_card_registration"]).contains("%@"), language)
        }
        let ru = try XCTUnwrap(NSDictionary(contentsOfFile: try XCTUnwrap(bundle.path(forResource: "CSCA", ofType: "strings", inDirectory: nil, forLocalization: "ru"))) as? [String: String])
        XCTAssertEqual(ru["csca_home_card_action"], "К подготовке")
    }

    // MARK: Место и поведение в исходниках

    func testTheCardIsHiddenOnFailureAndSitsFirstInTheContinueGroup() throws {
        let card = try source("Views/CSCA/CSCAHomeCardView.swift")
        // Нет плашки ошибки и повтора: сбой чтения ничего не рисует.
        XCTAssertFalse(card.contains("CSCAFailureView"))
        XCTAssertFalse(card.contains("retry"))
        XCTAssertFalse(card.contains("failure"))
        XCTAssertTrue(card.contains("if let home = model.home"))
        XCTAssertTrue(card.contains("NavigationLink(value: CSCARoute.home)"), "the action opens the CSCA screen")

        let home = try source("Views/HomeView.swift")
        let section = try XCTUnwrap(home.range(of: "CSCAHomeCardSection(model: cscaCard)"))
        let draftSplit = try XCTUnwrap(home.range(of: "if hasTestDraft {"))
        XCTAssertLessThan(section.lowerBound, draftSplit.lowerBound, "CSCA opens the learning and tests group")
        XCTAssertEqual(home.components(separatedBy: "CSCAHomeCardSection(model: cscaCard)").count, 2, "one place for both tiers")
        XCTAssertTrue(home.contains(".navigationDestination(for: CSCARoute.self)"), "the Home stack can open the CSCA screen")
        // Выбор читается один раз, главная CSCA сразу за ним: без второй волны на экране.
        XCTAssertTrue(home.contains("await countryTimeline.load()\n        await cscaCard.update(choice: countryTimeline.loadedChoice)"))
    }
}
