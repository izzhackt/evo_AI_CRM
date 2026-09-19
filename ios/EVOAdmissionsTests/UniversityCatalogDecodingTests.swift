import XCTest

/// Decoder tests against a FIXED fixture written by hand from the SQL return
/// shape of `platform_private.university_catalog_page` /
/// `platform.student_university_catalog`
/// (supabase/migrations/148_platform_university_catalog_publication.sql,
/// lines 208–233: `jsonb_build_object('items', …('id','version','publishedAt',
/// 'content')…, 'nextOffset', …)`), with content constrained by
/// `valid_university_content` (148) as extended by migrations 150/151
/// (photoKey set, `language` level). Field values are synthetic but every
/// key, nesting and null-ability matches the validator exactly.
final class UniversityCatalogDecodingTests: XCTestCase {
    private let pageFixture = """
    {
      "items": [
        {
          "id": "3b8fbd2e-6c1a-4c9e-9a71-0e6f4b1f2a10",
          "version": 3,
          "publishedAt": "2026-09-17T08:15:30.123456+00:00",
          "content": {
            "name": "Sunway University",
            "country": "MY",
            "city": "Subang Jaya",
            "overview": "Частный университет в агломерации Куала-Лумпура.",
            "websiteUrl": "https://sunwayuniversity.edu.my/",
            "sourceUrl": "https://sunwayuniversity.edu.my/admissions",
            "verifiedOn": "2026-09-01",
            "notes": "",
            "photoKey": "sunway",
            "programs": [
              {
                "id": "bsc-computer-science",
                "title": "BSc (Hons) Computer Science",
                "level": "bachelor",
                "duration": "3 года",
                "language": "Английский",
                "summary": "Программирование, данные и системы.",
                "sourceUrl": "https://sunwayuniversity.edu.my/programmes/bsc-cs",
                "intakes": [
                  {
                    "label": "Сентябрь 2026",
                    "startDate": "2026-09-21",
                    "startMonth": "2026-09",
                    "applicationDeadline": "2026-08-15",
                    "deadlineTime": "17:00",
                    "timezone": "Asia/Kuala_Lumpur",
                    "status": "open",
                    "note": "Документы принимает международный офис.",
                    "sourceUrl": "https://sunwayuniversity.edu.my/intakes",
                    "verifiedOn": "2026-09-01"
                  },
                  {
                    "label": "Январь 2027",
                    "startDate": null,
                    "startMonth": "2027-01",
                    "applicationDeadline": null,
                    "deadlineTime": null,
                    "timezone": null,
                    "status": "announced",
                    "note": "",
                    "sourceUrl": "https://sunwayuniversity.edu.my/intakes",
                    "verifiedOn": "2026-09-01"
                  }
                ]
              },
              {
                "id": "intensive-english",
                "title": "Intensive English Programme",
                "level": "language",
                "duration": null,
                "language": null,
                "summary": "",
                "sourceUrl": "https://sunwayuniversity.edu.my/programmes/iep",
                "intakes": []
              }
            ]
          }
        },
        {
          "id": "9d0a4a52-2a4f-4b5e-8a86-1c2d3e4f5a6b",
          "version": 1,
          "publishedAt": "2026-09-10T12:00:00+00:00",
          "content": {
            "name": "Charles University",
            "country": "CZ",
            "city": null,
            "overview": "Старейший университет Центральной Европы.",
            "websiteUrl": "https://cuni.cz/",
            "sourceUrl": "https://cuni.cz/UKEN-1.html",
            "verifiedOn": "2026-08-20",
            "notes": "Проверка программ продолжается.",
            "photoKey": null,
            "programs": [
              {
                "id": "medicine-md",
                "title": "General Medicine",
                "level": "master",
                "duration": "6 лет",
                "language": "Английский",
                "summary": "Клиническая подготовка с третьего курса.",
                "sourceUrl": "https://cuni.cz/UKEN-145.html",
                "intakes": [
                  {
                    "label": "Осень 2026",
                    "startDate": null,
                    "startMonth": null,
                    "applicationDeadline": "2026-02-28",
                    "deadlineTime": null,
                    "timezone": null,
                    "status": "closed",
                    "note": "",
                    "sourceUrl": "https://cuni.cz/UKEN-145.html",
                    "verifiedOn": "2026-08-20"
                  }
                ]
              }
            ]
          }
        }
      ],
      "nextOffset": 30
    }
    """

    func testDecodesFullPage() throws {
        let page = try JSONDecoder().decode(
            UniversityCatalogPage.self,
            from: Data(pageFixture.utf8)
        )
        XCTAssertEqual(page.nextOffset, 30)
        XCTAssertEqual(page.items.count, 2)

        let sunway = page.items[0]
        XCTAssertEqual(sunway.id, UUID(uuidString: "3b8fbd2e-6c1a-4c9e-9a71-0e6f4b1f2a10"))
        XCTAssertEqual(sunway.version, 3)
        XCTAssertEqual(sunway.content.photoKey, "sunway")
        XCTAssertEqual(sunway.content.city, "Subang Jaya")
        XCTAssertEqual(sunway.content.programs.count, 2)

        let program = sunway.content.programs[0]
        XCTAssertEqual(program.level, "bachelor")
        XCTAssertEqual(program.intakes.count, 2)
        XCTAssertEqual(program.intakes[0].deadlineTime, "17:00")
        XCTAssertEqual(program.intakes[0].timezone, "Asia/Kuala_Lumpur")
        XCTAssertNil(program.intakes[1].startDate)
        XCTAssertNil(program.intakes[1].applicationDeadline)

        // 151: the added `language` level decodes like any other.
        XCTAssertEqual(sunway.content.programs[1].level, "language")
        XCTAssertNil(sunway.content.programs[1].duration)
        XCTAssertTrue(sunway.content.programs[1].intakes.isEmpty)

        let charles = page.items[1]
        XCTAssertNil(charles.content.city)
        XCTAssertNil(charles.content.photoKey)
        XCTAssertEqual(charles.content.notes, "Проверка программ продолжается.")
    }

    func testDecodesLastPageWithNullNextOffset() throws {
        // 148 line 220: `'nextOffset', CASE WHEN count(*)>30 THEN … ELSE NULL END`.
        let fixture = """
        { "items": [], "nextOffset": null }
        """
        let page = try JSONDecoder().decode(
            UniversityCatalogPage.self,
            from: Data(fixture.utf8)
        )
        XCTAssertNil(page.nextOffset)
        XCTAssertTrue(page.items.isEmpty)
    }
}

/// The deadline/status computation must match the web portal
/// (`universityIntakeStatusKey`, src/lib/portal/universities.ts).
final class UniversityIntakeStatusTests: XCTestCase {
    private func intake(
        deadline: String? = nil,
        deadlineTime: String? = nil,
        timezone: String? = nil,
        status: String
    ) -> UniversityIntake {
        UniversityIntake(
            label: "Набор",
            startDate: nil,
            startMonth: nil,
            applicationDeadline: deadline,
            deadlineTime: deadlineTime,
            timezone: timezone,
            status: status,
            note: "",
            sourceUrl: "https://example-university.example/intakes",
            verifiedOn: "2026-09-01"
        )
    }

    private let now = ISO8601DateFormatter().date(from: "2026-09-19T12:00:00Z")!

    func testExplicitClosedStatus() {
        XCTAssertEqual(
            universityIntakeDisplayStatus(intake(status: "closed"), now: now),
            .closed
        )
    }

    func testPastDeadlineReadsClosedEvenWhenSourceSaysOpen() {
        XCTAssertEqual(
            universityIntakeDisplayStatus(
                intake(deadline: "2026-09-01", status: "open"),
                now: now
            ),
            .closed
        )
    }

    func testDeadlineTodayWithPassedTimeInTimezoneReadsClosed() {
        // 12:00Z = 20:00 in Asia/Kuala_Lumpur (+08:00); the 17:00 cutoff passed.
        XCTAssertEqual(
            universityIntakeDisplayStatus(
                intake(
                    deadline: "2026-09-19",
                    deadlineTime: "17:00",
                    timezone: "Asia/Kuala_Lumpur",
                    status: "open"
                ),
                now: now
            ),
            .closed
        )
    }

    func testFutureDeadlineKeepsSourceStatus() {
        XCTAssertEqual(
            universityIntakeDisplayStatus(
                intake(deadline: "2026-12-01", status: "open"),
                now: now
            ),
            .open
        )
        XCTAssertEqual(
            universityIntakeDisplayStatus(
                intake(deadline: "2026-12-01", status: "announced"),
                now: now
            ),
            .announced
        )
    }

    func testNeedsReconfirmationAndUnknown() {
        XCTAssertEqual(
            universityIntakeDisplayStatus(intake(status: "needs_reconfirmation"), now: now),
            .needsConfirmation
        )
        XCTAssertEqual(
            universityIntakeDisplayStatus(intake(status: "unknown"), now: now),
            .unclear
        )
    }
}
