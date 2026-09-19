import XCTest

/// Pure-policy units of the wave-8 accompaniment screens, in the
/// ProfileLanguagePolicy style — each mirrors a specific web behaviour:
/// - action queue — portal-source.ts readStudentPortalOverview:674-691;
/// - payments null rendering — 189 semantics as PaymentsView.tsx draws them;
/// - upload idempotency — PortalDocumentControls.tsx frozen-key ref;
/// - notification read — deterministic UUIDv5 command id
///   (student-portal-notification-command-id.ts) + the web's mark-all loop
///   over UNREAD ids only (notifications/page.tsx:21-30).
final class AdmissionPolicyTests: XCTestCase {
    // MARK: - Action queue (portal-source.ts:674-691)

    private func payment(
        label: String,
        outstanding: Int64,
        status: String = "pending",
        dueAt: String? = nil
    ) -> StudentPortalPaymentRow {
        StudentPortalPaymentRow(
            obligationLabel: label,
            category: "evo_service_fee",
            amountMinor: max(outstanding, 1),
            paidMinor: 0,
            refundedMinor: 0,
            outstandingMinor: outstanding,
            currency: "KGS",
            dueAt: dueAt,
            derivedStatus: status,
            overdue: status == "overdue",
            nextAction: nil
        )
    }

    func testQueueSortsOldestDueFirstWithUndatedLast() {
        let documentAction = AdmissionAction(
            kind: .uploadDocument,
            label: "Паспорт",
            dueAt: nil, // undated document — sinks to the end
            documentSlotId: UUID(),
            amountMinor: nil,
            currency: nil
        )
        let queue = AdmissionActionPolicy.queue(
            documentAction: documentAction,
            payments: [
                payment(label: "Поздний транш", outstanding: 100, dueAt: "2026-10-01T09:00:00+00:00"),
                payment(label: "Просроченный", outstanding: 200, status: "overdue", dueAt: "2026-09-01T09:00:00+00:00"),
            ]
        )
        XCTAssertEqual(queue.map(\.label), ["Просроченный", "Поздний транш", "Паспорт"])
    }

    func testQueueSkipsSettledAndCancelledObligations() {
        // outstanding == 0, cancelled and waived never enter the queue
        // (web: outstandingMinor > 0 && status not in cancelled/waived).
        let queue = AdmissionActionPolicy.queue(
            documentAction: nil,
            payments: [
                payment(label: "Оплачено", outstanding: 0, status: "paid"),
                payment(label: "Отменено", outstanding: 100, status: "cancelled"),
                payment(label: "Прощено", outstanding: 100, status: "waived"),
                payment(label: "Реальный долг", outstanding: 100),
            ]
        )
        XCTAssertEqual(queue.map(\.label), ["Реальный долг"])
        XCTAssertEqual(queue[0].kind, .payment)
        XCTAssertEqual(queue[0].amountMinor, 100)
    }

    func testQueueKeepsStableTiesDocumentFirst() {
        // Identical due dates: the incoming order survives (web comparator
        // returns 0 and the sort is stable) — the document action stays
        // ahead of same-due payments, and equal payments keep RPC order.
        let due = "2026-09-25T09:00:00+00:00"
        let documentAction = AdmissionAction(
            kind: .replaceDocument,
            label: "Аттестат",
            dueAt: due,
            documentSlotId: UUID(),
            amountMinor: nil,
            currency: nil
        )
        let queue = AdmissionActionPolicy.queue(
            documentAction: documentAction,
            payments: [
                payment(label: "Транш А", outstanding: 100, dueAt: due),
                payment(label: "Транш Б", outstanding: 200, dueAt: due),
            ]
        )
        XCTAssertEqual(queue.map(\.label), ["Аттестат", "Транш А", "Транш Б"])
    }

    // MARK: - Payments null semantics (189)

    func testUndatedPaymentDrawsNoDueLine() {
        // 189: NULL due_at means UNDATED («срок при необходимости») — the
        // due line simply does not render; nothing is invented.
        let undated = payment(label: "Транш", outstanding: 100, dueAt: nil)
        XCTAssertFalse(AdmissionPaymentPolicy.showsDueLine(undated))
        XCTAssertFalse(AdmissionPaymentPolicy.showsNextAction(undated))
        XCTAssertFalse(AdmissionPaymentPolicy.showsRefundedLine(undated))

        let dated = payment(label: "Этап 1", outstanding: 100, dueAt: "2026-09-30T09:00:00+00:00")
        XCTAssertTrue(AdmissionPaymentPolicy.showsDueLine(dated))
    }

    func testUnparseableDueTimestampRendersNothingNotAFabricatedDate() {
        XCTAssertNil(AdmissionTimestamp.label(from: "not-a-timestamp"))
        XCTAssertNil(AdmissionTimestamp.label(from: nil))
        // Sanity: a real timestamptz renders in the fixed Bishkek zone
        // (UTC+6): 09:00Z → 15:00.
        XCTAssertEqual(
            AdmissionTimestamp.label(from: "2026-09-30T09:00:00+00:00"),
            "30.09.2026, 15:00"
        )
    }

    // MARK: - Upload idempotency (PortalDocumentControls.tsx frozen key)

    func testRetryReusesTheFrozenKey() {
        var idempotency = DocumentUploadIdempotency()
        let first = idempotency.keyForAttempt()
        // The attempt failed; the retry must replay the SAME key so the
        // server resumes the same reservation instead of creating a dupe.
        let retry = idempotency.keyForAttempt()
        XCTAssertEqual(first, retry)
    }

    func testPickingAnotherFileMintsANewKey() {
        var idempotency = DocumentUploadIdempotency()
        let first = idempotency.keyForAttempt()
        // Different bytes must not replay the old reservation (web:
        // onChange clears the ref).
        idempotency.fileChanged()
        let second = idempotency.keyForAttempt()
        XCTAssertNotEqual(first, second)
    }

    func testSuccessClearsTheKeyForTheNextAttempt() {
        var idempotency = DocumentUploadIdempotency()
        let first = idempotency.keyForAttempt()
        idempotency.uploadSucceeded()
        XCTAssertNil(idempotency.frozenKey)
        let second = idempotency.keyForAttempt()
        XCTAssertNotEqual(first, second)
    }

    // MARK: - Notification read (deterministic UUIDv5 + mark-all scope)

    func testReadRequestIdMatchesTheWebReferenceVectors() {
        // Vectors computed with the reference algorithm of
        // src/lib/server/student-portal-notification-command-id.ts
        // (uuid5(namespace 73f89df8-d811-5352-9a97-a87652d591c1,
        //  "notification-read:org:case:membership:authUser:notification")).
        let org = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let studentCase = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let membership = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let authUser = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!

        let first = AdmissionNotificationPolicy.readRequestId(
            organizationId: org,
            studentCaseId: studentCase,
            membershipId: membership,
            authUserId: authUser,
            notificationId: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!
        )
        XCTAssertEqual(
            first,
            UUID(uuidString: "a96fea67-2c74-5ad5-b427-e766f170f8e6")
        )

        let second = AdmissionNotificationPolicy.readRequestId(
            organizationId: org,
            studentCaseId: studentCase,
            membershipId: membership,
            authUserId: authUser,
            notificationId: UUID(uuidString: "66666666-6666-4666-8666-666666666666")!
        )
        XCTAssertEqual(
            second,
            UUID(uuidString: "14c4b9c7-e980-59bf-850e-61446d43e30f")
        )
        XCTAssertNotEqual(first, second)

        // Determinism is the whole point: a retry (or a mark-all rerun)
        // derives the exact same command id and replays, never duplicates.
        XCTAssertEqual(
            first,
            AdmissionNotificationPolicy.readRequestId(
                organizationId: org,
                studentCaseId: studentCase,
                membershipId: membership,
                authUserId: authUser,
                notificationId: UUID(uuidString: "55555555-5555-4555-8555-555555555555")!
            )
        )
    }

    func testMarkAllTargetsOnlyUnreadNotifications() {
        // Mirror of the web mark-all action: it loops the single-item
        // command over UNREAD rows only (already-read rows are skipped, so
        // a rerun after a partial failure is safe).
        let unreadId = UUID()
        let rows = [
            StudentPortalNotificationRow(
                notificationId: UUID(),
                category: "document.review",
                eventCode: "approved",
                subjectLabel: "Паспорт",
                detail: nil,
                dueAt: nil,
                createdAt: "2026-09-18T09:00:00+00:00",
                readAt: "2026-09-18T10:00:00+00:00"
            ),
            StudentPortalNotificationRow(
                notificationId: unreadId,
                category: "payment.overdue",
                eventCode: "overdue",
                subjectLabel: "Этап 1",
                detail: nil,
                dueAt: "2026-09-10T09:00:00+00:00",
                createdAt: "2026-09-11T00:00:00+00:00",
                readAt: nil
            ),
        ]
        XCTAssertEqual(AdmissionNotificationPolicy.unreadIds(rows), [unreadId])
    }

    func testNotificationTargetsMirrorTheWebMap() {
        // portalNotificationTarget (presentation.ts): category prefix
        // routes document*/payment*; case_help_answer is the one event-code
        // special case; anything else has no link (the hub IS the overview).
        XCTAssertEqual(
            AdmissionNotificationPolicy.target(category: "document.review", eventCode: "approved"),
            .documents
        )
        XCTAssertEqual(
            AdmissionNotificationPolicy.target(category: "document.overdue", eventCode: "overdue"),
            .documents
        )
        XCTAssertEqual(
            AdmissionNotificationPolicy.target(category: "payment.overdue", eventCode: "overdue"),
            .payments
        )
        XCTAssertEqual(
            AdmissionNotificationPolicy.target(
                category: "case_help.answer",
                eventCode: "case_help_answer"
            ),
            .caseHelpReplyDisclosure
        )
        XCTAssertEqual(
            AdmissionNotificationPolicy.target(category: "something.new", eventCode: "created"),
            AdmissionNotificationTarget.none
        )
    }

    // MARK: - Multipart body (upload contract: exactly one `file` part)

    func testMultipartBodyCarriesExactlyOneFilePart() throws {
        let body = PortalDocumentTransfer.multipartBody(
            boundary: "evo-test-boundary",
            filename: "passport.pdf",
            mimeType: "application/pdf",
            fileData: Data("PDFBYTES".utf8)
        )
        let text = try XCTUnwrap(String(data: body, encoding: .utf8))
        XCTAssertTrue(text.hasPrefix("--evo-test-boundary\r\n"))
        XCTAssertTrue(text.contains(
            "Content-Disposition: form-data; name=\"file\"; filename=\"passport.pdf\"\r\n"
        ))
        XCTAssertTrue(text.contains("Content-Type: application/pdf\r\n\r\nPDFBYTES"))
        XCTAssertTrue(text.hasSuffix("\r\n--evo-test-boundary--\r\n"))
        // Exactly ONE part: one Content-Disposition header in the body.
        XCTAssertEqual(
            text.components(separatedBy: "Content-Disposition").count - 1,
            1
        )
    }

    func testUploadFailureMappingMirrorsTheWeb() {
        // uploadFailureMessage (PortalDocumentControls.tsx:270-283).
        XCTAssertEqual(PortalDocumentTransfer.failure(forStatus: 400), .badFile)
        XCTAssertEqual(PortalDocumentTransfer.failure(forStatus: 415), .badFile)
        XCTAssertEqual(PortalDocumentTransfer.failure(forStatus: 403), .forbidden)
        XCTAssertEqual(PortalDocumentTransfer.failure(forStatus: 409), .conflict)
        XCTAssertEqual(PortalDocumentTransfer.failure(forStatus: 413), .tooLarge)
        XCTAssertEqual(PortalDocumentTransfer.failure(forStatus: 422), .scanRejected)
        XCTAssertEqual(PortalDocumentTransfer.failure(forStatus: 429), .rateLimited)
        XCTAssertEqual(PortalDocumentTransfer.failure(forStatus: 503), .unavailable)
    }
}
