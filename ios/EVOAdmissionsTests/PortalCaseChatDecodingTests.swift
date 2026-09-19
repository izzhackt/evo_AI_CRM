import XCTest

/// Decoder tests against fixtures hand-written from the SQL return shapes of
/// `supabase/migrations/200_platform_portal_case_chat.sql`:
/// - page — 200:206-209 `{messages, cursor, hasMore, awaitState}`, строки
///   200:177-187 NEWEST FIRST (`ORDER BY m.sequence_id DESC`);
/// - документ-вложение — label живого слота ИЛИ NULL для удалённого
///   (200:183-185 + join 200:196-200);
/// - task-вложение — attachmentLabel ВСЕГДА NULL для студента (контракт §6,
///   комментарий 200:168-172): карточка задачи не рендерится вовсе;
/// - post receipt — 200:117-119.
final class PortalCaseChatDecodingTests: XCTestCase {
    func testDecodesPageWithDocumentTaskAndQuoteRows() throws {
        let fixture = """
        {
          "messages": [
            {
              "id": "0f5b2f5e-6f0a-4d5c-9e3b-1a2b3c4d5e6f",
              "sequenceId": "42",
              "mine": true,
              "authorName": "Айдана Абдыраимова",
              "body": "Добрый день! Загрузила паспорт.",
              "createdAt": "2026-09-19T12:30:00.123456+00:00",
              "attachmentKind": null,
              "attachmentLabel": null,
              "quotedBodyPreview": null
            },
            {
              "id": "1a2b3c4d-5e6f-4a0b-8c1d-2e3f4a5b6c7d",
              "sequenceId": "41",
              "mine": false,
              "authorName": "Куратор EVO",
              "body": "",
              "createdAt": "2026-09-19T12:00:00+00:00",
              "attachmentKind": "document",
              "attachmentLabel": "Паспорт (разворот с фото)",
              "quotedBodyPreview": null
            },
            {
              "id": "2b3c4d5e-6f7a-4b1c-9d2e-3f4a5b6c7d8e",
              "sequenceId": "40",
              "mine": false,
              "authorName": "Куратор EVO",
              "body": "Слот удалили, но сообщение осталось.",
              "createdAt": "2026-09-19T11:00:00+00:00",
              "attachmentKind": "document",
              "attachmentLabel": null,
              "quotedBodyPreview": null
            },
            {
              "id": "3c4d5e6f-7a8b-4c2d-8e3f-4a5b6c7d8e9f",
              "sequenceId": "39",
              "mine": false,
              "authorName": "Куратор EVO",
              "body": "Посмотрите задачу в кабинете.",
              "createdAt": "2026-09-19T10:00:00+00:00",
              "attachmentKind": "case_task",
              "attachmentLabel": null,
              "quotedBodyPreview": "Добрый день! Загрузила паспорт."
            }
          ],
          "cursor": "39",
          "hasMore": true,
          "awaitState": "awaiting_student"
        }
        """
        let page = try JSONDecoder().decode(
            PortalCaseChatPage.self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(page.messages.count, 4)
        XCTAssertEqual(page.cursor, "39")
        XCTAssertTrue(page.hasMore)
        XCTAssertEqual(page.awaitState, "awaiting_student")

        let mine = page.messages[0]
        XCTAssertTrue(mine.mine)
        XCTAssertNil(mine.attachmentKind)
        XCTAssertEqual(mine.sequenceValue, 42)

        // Живой документ-слот: честный label (left(…, 300), 200:183-185).
        let liveDocument = page.messages[1]
        XCTAssertTrue(liveDocument.isDocumentAttachment)
        XCTAssertEqual(liveDocument.attachmentLabel, "Паспорт (разворот с фото)")
        // Тело может быть пустым у attachment-only сообщения (CHECK 191).
        XCTAssertEqual(liveDocument.body, "")

        // Удалённый слот: kind=document, label=NULL — нейтральная подпись.
        let removedDocument = page.messages[2]
        XCTAssertTrue(removedDocument.isDocumentAttachment)
        XCTAssertNil(removedDocument.attachmentLabel)

        // case_task: label NULL по построению — карточка НЕ рендерится.
        let task = page.messages[3]
        XCTAssertEqual(task.attachmentKind, "case_task")
        XCTAssertNil(task.attachmentLabel)
        XCTAssertFalse(task.isDocumentAttachment)
        XCTAssertEqual(task.quotedBodyPreview, "Добрый день! Загрузила паспорт.")
    }

    func testDecodesEmptyThreadPage() throws {
        // Пустой тред: [] + cursor '0' (COALESCE(min(...), 0), 200:159) +
        // awaitState 'none' (COALESCE, 200:208).
        let page = try JSONDecoder().decode(
            PortalCaseChatPage.self,
            from: Data("""
            { "messages": [], "cursor": "0", "hasMore": false, "awaitState": "none" }
            """.utf8)
        )
        XCTAssertTrue(page.messages.isEmpty)
        XCTAssertFalse(page.hasMore)
        XCTAssertEqual(page.awaitState, "none")
    }

    func testDecodesPostReceipt() throws {
        // 200:117-119.
        let receipt = try JSONDecoder().decode(
            PortalCaseChatPostReceipt.self,
            from: Data("""
            {
              "requestId": "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a",
              "studentCaseId": "8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b",
              "mode": "portal_post",
              "messageId": "9f0a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
              "sequenceId": "43",
              "createdAt": "2026-09-19T12:31:00+00:00"
            }
            """.utf8)
        )
        XCTAssertEqual(receipt.mode, "portal_post")
        XCTAssertEqual(receipt.sequenceId, "43")
    }
}
