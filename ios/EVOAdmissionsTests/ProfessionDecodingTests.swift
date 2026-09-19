import XCTest

/// Decoder tests against fixtures hand-written from the SQL return shapes of
/// `supabase/migrations/198_platform_learning_engine.sql`:
/// - `profession_cards_v1` — 198:1043-1050 `{cards: [{cardId, cardKey,
///   version, titleRu, titleKy, orvisScales}]}`
/// - `profession_card_v1` — 198:1060-1061 `{cardId, cardKey, version,
///   publishedAt, body}`; body validated to EXACTLY 20 keys by
///   `validate_profession_card` (198:340-345), values shaped like the real
///   199 seed (199:359-360, card `project-manager`).
final class ProfessionDecodingTests: XCTestCase {
    func testDecodesCardsGrid() throws {
        let fixture = """
        {
          "cards": [
            {
              "cardId": "bf56c901-7335-5deb-811b-ae730ec826ca",
              "cardKey": "project-manager",
              "version": "1.0.0",
              "titleRu": "Менеджер проектов",
              "titleKy": "Долбоор менеджери",
              "orvisScales": ["leadership", "organization"]
            },
            {
              "cardId": "d0681dcd-bf56-5aef-8b02-c5d3861ed3fd",
              "cardKey": "marketing-manager",
              "version": "1.0.0",
              "titleRu": "Маркетолог",
              "titleKy": "Маркетолог",
              "orvisScales": ["leadership", "creativity"]
            }
          ]
        }
        """
        let response = try JSONDecoder().decode(
            ProfessionCardsResponse.self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(response.cards.count, 2)
        XCTAssertEqual(response.cards[0].cardKey, "project-manager")
        XCTAssertEqual(response.cards[0].titleKy, "Долбоор менеджери")
        // Первая шкала — основная (валидатор 198:353).
        XCTAssertEqual(response.cards[0].orvisScales.first, "leadership")
    }

    func testDecodesFullCardBody() throws {
        // Все 20 ключей body (198:341-345); списки RU/KY одинаковой длины
        // (198:365-378); linked_program_refs с exact-парой ключей
        // (198:379-386); sources — только https (198:387-390).
        let fixture = """
        {
          "cardId": "bf56c901-7335-5deb-811b-ae730ec826ca",
          "cardKey": "project-manager",
          "version": "1.0.0",
          "publishedAt": "2026-09-19T08:00:00.42+00:00",
          "body": {
            "id": "project-manager",
            "title_ru": "Менеджер проектов",
            "title_ky": "Долбоор менеджери",
            "orvis_scales": ["leadership", "organization"],
            "day_in_work_ru": "Утро начинается с короткой встречи команды.",
            "day_in_work_ky": "Таң эрте кыска жолугушуудан башталат.",
            "environment_ru": "Офис или удалённая работа, много общения.",
            "environment_ky": "Кеңсе же алыстан иштөө, көп баарлашуу.",
            "skills_ru": ["Планирование", "Общение"],
            "skills_ky": ["Пландоо", "Баарлашуу"],
            "interesting_ru": ["Виден результат"],
            "interesting_ky": ["Натыйжа көрүнөт"],
            "hard_ru": ["Отвечаешь за срок"],
            "hard_ky": ["Мөөнөт үчүн жооп бересиң"],
            "trial_task_ru": "Спланируйте семейный ужин на шесть человек.",
            "trial_task_ky": "Алты кишилик үй-бүлөлүк кечки тамакты пландаңыз.",
            "study_directions_ru": ["Менеджмент", "Управление проектами"],
            "study_directions_ky": ["Менеджмент", "Долбоорлорду башкаруу"],
            "linked_program_refs": [
              {
                "institution_photo_key": "kozminski-university",
                "program_hint": "Bachelor in Management"
              }
            ],
            "sources": ["https://www.onetonline.org/link/summary/13-1082.00"]
          }
        }
        """
        let response = try JSONDecoder().decode(
            ProfessionCardResponse.self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(response.cardKey, "project-manager")
        XCTAssertNotNil(PostgresTimestamp.date(from: response.publishedAt))

        let body = response.body
        XCTAssertEqual(body.id, response.cardKey) // 198:346: id = card_key.
        XCTAssertEqual(body.titleRu, "Менеджер проектов")
        XCTAssertEqual(body.orvisScales, ["leadership", "organization"])
        XCTAssertEqual(body.skillsRu.count, body.skillsKy.count)
        XCTAssertEqual(body.studyDirectionsRu.count, body.studyDirectionsKy.count)
        XCTAssertEqual(body.linkedProgramRefs.count, 1)
        XCTAssertEqual(body.linkedProgramRefs[0].institutionPhotoKey, "kozminski-university")
        XCTAssertEqual(body.linkedProgramRefs[0].programHint, "Bachelor in Management")
        XCTAssertEqual(body.sources, ["https://www.onetonline.org/link/summary/13-1082.00"])
    }
}
