import XCTest

/// Decoder tests against fixtures hand-written from the SQL return shapes of
/// the accompaniment read-contracts (the same RPCs the web PORT-5d screens
/// read):
/// - `student_portal_overview_v2` — RETURNS TABLE,
///   supabase/migrations/131_platform_student_portal_next_steps.sql:17-30;
/// - `student_portal_documents` — RETURNS TABLE,
///   supabase/migrations/128_platform_student_document_download.sql:675-694;
/// - `student_portal_finance_v2` — RETURNS TABLE,
///   supabase/migrations/127_platform_student_portal_read_models.sql:472-485,
///   `due_at` honest-NULL and NULL-safe `overdue` per
///   189_platform_case_agreement.sql:62-78 and 189:242-257;
/// - `student_portal_notifications_v2` — RETURNS TABLE,
///   supabase/migrations/153_platform_student_help_reply_notifications.sql:97-106;
/// - `mark_own_student_portal_notification_read_v2` — receipt
///   jsonb_build_object 153:314-318.
final class AdmissionDecodingTests: XCTestCase {
    // MARK: - Overview (131:17-30)

    func testDecodesOverviewWithDocumentActionEvoTaskAndCurator() throws {
        // Column set exactly as RETURNS TABLE 131:18-30; evo_action carries
        // due_on (DATE) and no due_at — 131 emits at most one of the pair.
        let fixture = """
        [{
          "operational_stage": "Сбор документов",
          "student_action_kind": "replace_document",
          "student_action_label": "Паспорт (разворот с фото)",
          "student_action_due_at": "2026-09-25T09:00:00+00:00",
          "student_action_document_slot_id": "0f5b2f5e-6f0a-4d5c-9e3b-1a2b3c4d5e6f",
          "evo_action_task_id": "1a2b3c4d-5e6f-4a0b-8c1d-2e3f4a5b6c7d",
          "evo_action_title": "Подать заявку в университет",
          "evo_action_status": "in_progress",
          "evo_action_due_at": null,
          "evo_action_due_on": "2026-10-01",
          "curator_display_name": "Айгуль Осмонова"
        }]
        """
        let rows = try JSONDecoder().decode(
            [StudentPortalOverviewRow].self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(rows.count, 1)
        let row = rows[0]
        XCTAssertEqual(row.operationalStage, "Сбор документов")

        let action = try XCTUnwrap(row.documentAction)
        XCTAssertEqual(action.kind, .replaceDocument)
        XCTAssertEqual(action.label, "Паспорт (разворот с фото)")
        XCTAssertEqual(action.dueAt, "2026-09-25T09:00:00+00:00")
        XCTAssertEqual(
            action.documentSlotId,
            UUID(uuidString: "0f5b2f5e-6f0a-4d5c-9e3b-1a2b3c4d5e6f")
        )

        let evo = try XCTUnwrap(row.evoAction)
        XCTAssertEqual(evo.title, "Подать заявку в университет")
        XCTAssertEqual(evo.status, "in_progress")
        XCTAssertNil(evo.dueAt)
        XCTAssertEqual(evo.dueOn, "2026-10-01")
        XCTAssertEqual(row.curatorDisplayName, "Айгуль Осмонова")
    }

    func testDecodesOverviewWithNoActionsAndNoCurator() throws {
        // The action groups are all-or-nothing (web normalizer,
        // portal-source.ts): all-NULL groups mean "no action" — the honest
        // calm state, not an invented one.
        let fixture = """
        [{
          "operational_stage": "Ожидание решения",
          "student_action_kind": null,
          "student_action_label": null,
          "student_action_due_at": null,
          "student_action_document_slot_id": null,
          "evo_action_task_id": null,
          "evo_action_title": null,
          "evo_action_status": null,
          "evo_action_due_at": null,
          "evo_action_due_on": null,
          "curator_display_name": null
        }]
        """
        let row = try JSONDecoder().decode(
            [StudentPortalOverviewRow].self,
            from: Data(fixture.utf8)
        )[0]
        XCTAssertNil(row.documentAction)
        XCTAssertNil(row.evoAction)
        XCTAssertNil(row.curatorDisplayName)
    }

    func testPartialActionGroupNeverAssemblesAnAction() throws {
        // A malformed partial group (kind present, slot id missing) must
        // read as NO action — never a fabricated one (mirrors the web's
        // fail-closed normalizer semantics for the UI outcome).
        let fixture = """
        [{
          "operational_stage": "Сбор документов",
          "student_action_kind": "upload_document",
          "student_action_label": null,
          "student_action_due_at": null,
          "student_action_document_slot_id": null,
          "evo_action_task_id": "1a2b3c4d-5e6f-4a0b-8c1d-2e3f4a5b6c7d",
          "evo_action_title": null,
          "evo_action_status": null,
          "evo_action_due_at": null,
          "evo_action_due_on": null,
          "curator_display_name": null
        }]
        """
        let row = try JSONDecoder().decode(
            [StudentPortalOverviewRow].self,
            from: Data(fixture.utf8)
        )[0]
        XCTAssertNil(row.documentAction)
        XCTAssertNil(row.evoAction)
    }

    // MARK: - Documents (128:675-694)

    func testDecodesDocumentChecklistRows() throws {
        // Three real shapes of one checklist:
        // - approved slot with its accepted version (version_* all present,
        //   review_decision='approved', rework_reason NULL);
        // - required slot with NO version (version_* and review_* all NULL);
        // - correction_required slot with a version and a rework reason
        //   (review co-constraints of the web normalizer).
        let fixture = """
        [
          {
            "case_id": "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a",
            "document_slot_id": "0f5b2f5e-6f0a-4d5c-9e3b-1a2b3c4d5e6f",
            "requirement_key": "passport.main",
            "requirement_label": "Паспорт (разворот с фото)",
            "instructions": "Цветной скан, все углы видны.",
            "slot_status": "approved",
            "deadline": "2026-09-25T09:00:00+00:00",
            "next_action": null,
            "document_version_id": "1a2b3c4d-5e6f-4a0b-8c1d-2e3f4a5b6c7d",
            "version_no": 3,
            "original_filename": "passport.pdf",
            "declared_mime_type": "application/pdf",
            "byte_size": 1048576,
            "submitted_at": "2026-09-18T14:30:00.123456+00:00",
            "review_decision": "approved",
            "rework_reason": null,
            "reviewed_at": "2026-09-19T08:00:00+00:00"
          },
          {
            "case_id": "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a",
            "document_slot_id": "2b3c4d5e-6f7a-4b1c-9d2e-3f4a5b6c7d8e",
            "requirement_key": null,
            "requirement_label": "Мотивационное письмо",
            "instructions": null,
            "slot_status": "required",
            "deadline": null,
            "next_action": "Загрузите файл до конца недели.",
            "document_version_id": null,
            "version_no": null,
            "original_filename": null,
            "declared_mime_type": null,
            "byte_size": null,
            "submitted_at": null,
            "review_decision": null,
            "rework_reason": null,
            "reviewed_at": null
          },
          {
            "case_id": "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a",
            "document_slot_id": "3c4d5e6f-7a8b-4c2d-8e3f-4a5b6c7d8e9f",
            "requirement_key": "transcript",
            "requirement_label": "Аттестат",
            "instructions": null,
            "slot_status": "correction_required",
            "deadline": "2026-09-30T09:00:00+00:00",
            "next_action": "Загрузите исправленный файл.",
            "document_version_id": "4d5e6f7a-8b9c-4d3e-9f4a-5b6c7d8e9f0a",
            "version_no": 1,
            "original_filename": "attestat.jpg",
            "declared_mime_type": "image/jpeg",
            "byte_size": 2097152,
            "submitted_at": "2026-09-17T10:00:00+00:00",
            "review_decision": "correction_required",
            "rework_reason": "Скан нечитаем, переснимите при дневном свете.",
            "reviewed_at": "2026-09-18T09:00:00+00:00"
          }
        ]
        """
        let documents = try JSONDecoder().decode(
            [StudentPortalDocumentRow].self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(documents.count, 3)

        let approved = documents[0]
        XCTAssertEqual(approved.slotStatus, "approved")
        XCTAssertEqual(approved.versionNo, 3)
        XCTAssertEqual(approved.declaredMimeType, "application/pdf")
        XCTAssertEqual(approved.reviewDecision, "approved")
        XCTAssertNil(approved.reworkReason)
        // Accepted slot is download-only (web allowUpload rule).
        XCTAssertFalse(approved.allowsUpload)

        let required = documents[1]
        XCTAssertEqual(required.slotStatus, "required")
        XCTAssertNil(required.documentVersionId)
        XCTAssertNil(required.versionNo)
        XCTAssertNil(required.reviewDecision)
        XCTAssertTrue(required.allowsUpload)

        let correction = documents[2]
        XCTAssertEqual(correction.reviewDecision, "correction_required")
        XCTAssertEqual(
            correction.reworkReason,
            "Скан нечитаем, переснимите при дневном свете."
        )
        XCTAssertTrue(correction.allowsUpload)

        // Progress counters (web documentProgress semantics).
        XCTAssertEqual(AdmissionDocumentProgress.approvedCount(documents), 1)
        XCTAssertEqual(AdmissionDocumentProgress.missingCount(documents), 1)
        XCTAssertEqual(AdmissionDocumentProgress.correctionsCount(documents), 1)
        XCTAssertEqual(AdmissionDocumentProgress.inReviewCount(documents), 0)
    }

    // MARK: - Finance (127:472-485 + 189 null semantics)

    func testDecodesPaymentsIncludingUndatedTranche() throws {
        // Row 1: dated, pending, nothing paid.
        // Row 2: the 189 case — due_at NULL (undated tranche, «срок при
        //   необходимости»), partially paid with a refund; overdue is FALSE
        //   because NULL due_at is never overdue (NULL-safe patch
        //   189:242-257).
        // Row 3: fully paid — outstanding 0, no next_action.
        let fixture = """
        [
          {
            "obligation_label": "Услуги EVO — этап 1",
            "category": "evo_service_fee",
            "amount_minor": 5000000,
            "paid_minor": 0,
            "refunded_minor": 0,
            "outstanding_minor": 5000000,
            "currency": "KGS",
            "due_at": "2026-09-30T09:00:00+00:00",
            "derived_status": "pending",
            "overdue": false,
            "next_action": "Оплатите по реквизитам из договора."
          },
          {
            "obligation_label": "Услуги EVO — транш по соглашению",
            "category": "evo_service_fee",
            "amount_minor": 3000000,
            "paid_minor": 1500000,
            "refunded_minor": 500000,
            "outstanding_minor": 2000000,
            "currency": "KGS",
            "due_at": null,
            "derived_status": "partially_paid",
            "overdue": false,
            "next_action": null
          },
          {
            "obligation_label": "Регистрационный сбор университета",
            "category": "third_party_cost",
            "amount_minor": 15000,
            "paid_minor": 15000,
            "refunded_minor": 0,
            "outstanding_minor": 0,
            "currency": "USD",
            "due_at": "2026-08-01T09:00:00+00:00",
            "derived_status": "paid",
            "overdue": false,
            "next_action": null
          }
        ]
        """
        let payments = try JSONDecoder().decode(
            [StudentPortalPaymentRow].self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(payments.count, 3)

        let undated = payments[1]
        XCTAssertNil(undated.dueAt)
        XCTAssertEqual(undated.derivedStatus, "partially_paid")
        XCTAssertFalse(undated.overdue)
        XCTAssertEqual(undated.outstandingMinor, 2_000_000)
        XCTAssertEqual(undated.refundedMinor, 500_000)

        let paid = payments[2]
        XCTAssertEqual(paid.derivedStatus, "paid")
        XCTAssertEqual(paid.outstandingMinor, 0)
    }

    // MARK: - Notifications (153:97-106) + receipt (153:314-318)

    func testDecodesNotificationRows() throws {
        // Unread document review (event_code = review decision, 153:137),
        // read case-help answer (event_code 'case_help_answer', 153:60) and
        // an overdue payment reminder with due_at (069 projection,
        // event_code 'overdue' per 153:179).
        let fixture = """
        [
          {
            "notification_id": "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
            "category": "document.review",
            "event_code": "correction_required",
            "subject_label": "Аттестат",
            "detail": "Скан нечитаем, переснимите при дневном свете.",
            "due_at": null,
            "created_at": "2026-09-18T09:00:00.654321+00:00",
            "read_at": null
          },
          {
            "notification_id": "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e",
            "category": "case_help.answer",
            "event_code": "case_help_answer",
            "subject_label": "Вопрос по срокам подачи",
            "detail": null,
            "due_at": null,
            "created_at": "2026-09-17T12:00:00+00:00",
            "read_at": "2026-09-17T15:00:00+00:00"
          },
          {
            "notification_id": "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
            "category": "payment.overdue",
            "event_code": "overdue",
            "subject_label": "Услуги EVO — этап 1",
            "detail": "Оплата просрочена.",
            "due_at": "2026-09-10T09:00:00+00:00",
            "created_at": "2026-09-11T00:00:00+00:00",
            "read_at": null
          }
        ]
        """
        let notifications = try JSONDecoder().decode(
            [StudentPortalNotificationRow].self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(notifications.count, 3)
        XCTAssertTrue(notifications[0].isUnread)
        XCTAssertFalse(notifications[1].isUnread)
        XCTAssertTrue(notifications[2].isUnread)
        XCTAssertEqual(notifications[2].dueAt, "2026-09-10T09:00:00+00:00")
    }

    func testDecodesNotificationReadReceipt() throws {
        // jsonb_build_object 153:314-318.
        let receipt = try JSONDecoder().decode(
            NotificationReadReceipt.self,
            from: Data("""
            {
              "notification_id": "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
              "is_read": true,
              "read_at": "2026-09-19T10:00:00.5+00:00"
            }
            """.utf8)
        )
        XCTAssertTrue(receipt.isRead)
        XCTAssertEqual(
            receipt.notificationId,
            UUID(uuidString: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d")
        )
        XCTAssertEqual(receipt.readAt, "2026-09-19T10:00:00.5+00:00")
    }

    // MARK: - Upload receipt (route-handlers.ts:1461-1473, student audience)

    func testDecodesDocumentUploadReceipt() throws {
        // The student response carries exactly these six document fields
        // (staff additionally gets studentCaseId/sha256Hex — not here).
        let receipt = try JSONDecoder().decode(
            PortalDocumentTransfer.UploadReceipt.self,
            from: Data("""
            {
              "document": {
                "documentSlotId": "3c4d5e6f-7a8b-4c2d-8e3f-4a5b6c7d8e9f",
                "documentVersionId": "8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a",
                "versionNumber": 2,
                "originalFilename": "attestat-v2.pdf",
                "declaredMimeType": "application/pdf",
                "byteSize": 524288
              }
            }
            """.utf8)
        )
        XCTAssertEqual(receipt.document.versionNumber, 2)
        XCTAssertEqual(receipt.document.originalFilename, "attestat-v2.pdf")
        XCTAssertEqual(receipt.document.byteSize, 524_288)
    }
}
