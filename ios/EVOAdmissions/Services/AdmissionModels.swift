import CryptoKit
import Foundation

/// Codable mirrors of the STUDENT accompaniment read-contracts the web
/// PORT-5d screens consume — the same `platform.*` RPCs, called directly
/// over PostgREST (ADR 0030 §1). Sources, per row shape:
/// - overview — `student_portal_overview_v2()`,
///   supabase/migrations/131_platform_student_portal_next_steps.sql:17-30;
/// - documents — `student_portal_documents()`,
///   supabase/migrations/128_platform_student_document_download.sql:675-694
///   (status machine refined by migration 108);
/// - finance — `student_portal_finance_v2()`,
///   supabase/migrations/127_platform_student_portal_read_models.sql:472-485,
///   `overdue` NULL-safety patched by 189_platform_case_agreement.sql:242-257;
/// - notifications — `student_portal_notifications_v2()`,
///   supabase/migrations/153_platform_student_help_reply_notifications.sql:97-106;
/// - mark-read receipt — `mark_own_student_portal_notification_read_v2`,
///   153:210-213, result JSONB 153:314-318.
///
/// Timestamps stay raw strings (see `PostgresTimestamp`); nothing here
/// invents display defaults — NULL from SQL means "absent" in the UI too.

// MARK: - Overview (131:17-30)

/// Single row of `student_portal_overview_v2()`. The student_action_* and
/// evo_action_* column groups are all-or-nothing by construction (the web
/// normalizer rejects partial groups, portal-source.ts
/// `normalizeStudentPortalOverview`); the computed accessors below only
/// assemble a value when its group is complete — a partial group renders as
/// "no action", never as an invented one.
struct StudentPortalOverviewRow: Decodable {
    let operationalStage: String
    let studentActionKind: String?
    let studentActionLabel: String?
    let studentActionDueAt: String?
    let studentActionDocumentSlotId: UUID?
    let evoActionTaskId: UUID?
    let evoActionTitle: String?
    let evoActionStatus: String?
    let evoActionDueAt: String?
    /// DATE (YYYY-MM-DD) — an all-day due date; mutually exclusive with
    /// evoActionDueAt (131 emits at most one of the pair).
    let evoActionDueOn: String?
    let curatorDisplayName: String?

    enum CodingKeys: String, CodingKey {
        case operationalStage = "operational_stage"
        case studentActionKind = "student_action_kind"
        case studentActionLabel = "student_action_label"
        case studentActionDueAt = "student_action_due_at"
        case studentActionDocumentSlotId = "student_action_document_slot_id"
        case evoActionTaskId = "evo_action_task_id"
        case evoActionTitle = "evo_action_title"
        case evoActionStatus = "evo_action_status"
        case evoActionDueAt = "evo_action_due_at"
        case evoActionDueOn = "evo_action_due_on"
        case curatorDisplayName = "curator_display_name"
    }

    /// upload_document | replace_document (portal-source.ts
    /// STUDENT_PORTAL_DOCUMENT_ACTION_KINDS).
    var documentAction: AdmissionAction? {
        guard
            let kind = studentActionKind,
            kind == "upload_document" || kind == "replace_document",
            let label = studentActionLabel,
            let slotId = studentActionDocumentSlotId
        else { return nil }
        return AdmissionAction(
            kind: kind == "upload_document" ? .uploadDocument : .replaceDocument,
            label: label,
            dueAt: studentActionDueAt,
            documentSlotId: slotId,
            amountMinor: nil,
            currency: nil
        )
    }

    var evoAction: EvoAction? {
        guard
            let taskId = evoActionTaskId,
            let title = evoActionTitle,
            let status = evoActionStatus
        else { return nil }
        return EvoAction(
            taskId: taskId,
            title: title,
            status: status,
            dueAt: evoActionDueAt,
            dueOn: evoActionDueOn
        )
    }
}

/// The EVO-team column of the overview (131: evo_action_* + curator).
struct EvoAction: Equatable {
    let taskId: UUID
    let title: String
    /// open | in_progress | blocked (131 filters to these three).
    let status: String
    let dueAt: String?
    let dueOn: String?
}

// MARK: - Student action queue (mirrors portal-source.ts:674-691)

/// One queued student action: the overview's document action or a
/// finance-derived payment action (web readStudentPortalOverview composes
/// both into `studentActions`).
struct AdmissionAction: Equatable {
    enum Kind: Equatable {
        case uploadDocument
        case replaceDocument
        case payment
    }

    let kind: Kind
    let label: String
    let dueAt: String?
    let documentSlotId: UUID?
    /// For .payment: the OUTSTANDING amount (web pushes
    /// payment.outstandingMinor as the action amount).
    let amountMinor: Int64?
    let currency: String?
}

/// Pure mirror of the web's action-queue assembly
/// (src/lib/v3/portal-source.ts readStudentPortalOverview, lines 674-691):
/// - a payment row joins the queue only while something is outstanding and
///   the status is not cancelled/waived;
/// - the queue sorts oldest-due-first; undated actions sink to the end;
/// - ties keep their incoming order (document first, then the finance RPC's
///   own row order) — the web comparator returns 0 for equal keys and the
///   sort is stable.
enum AdmissionActionPolicy {
    static func queue(
        documentAction: AdmissionAction?,
        payments: [StudentPortalPaymentRow]
    ) -> [AdmissionAction] {
        var choices: [AdmissionAction] = []
        if let documentAction { choices.append(documentAction) }
        for payment in payments {
            guard
                payment.outstandingMinor > 0,
                payment.derivedStatus != "cancelled",
                payment.derivedStatus != "waived"
            else { continue }
            choices.append(AdmissionAction(
                kind: .payment,
                label: payment.obligationLabel,
                dueAt: payment.dueAt,
                documentSlotId: nil,
                amountMinor: payment.outstandingMinor,
                currency: payment.currency
            ))
        }
        // Stable sort by parsed due date; nil (undated) sorts as +infinity —
        // Swift's sorted(by:) is NOT guaranteed stable, so decorate with the
        // original index to reproduce the web's stable ties exactly.
        return choices.enumerated()
            .sorted { left, right in
                let leftDue = dueKey(left.element.dueAt)
                let rightDue = dueKey(right.element.dueAt)
                if leftDue != rightDue { return leftDue < rightDue }
                return left.offset < right.offset
            }
            .map(\.element)
    }

    private static func dueKey(_ raw: String?) -> TimeInterval {
        guard
            let raw,
            let date = PostgresTimestamp.date(from: raw)
        else { return .infinity }
        return date.timeIntervalSince1970
    }
}

// MARK: - Documents (128:675-694)

/// One checklist slot with its LATEST version and review outcome. The
/// version_* fields are all-NULL or all-present together, and a review
/// decision exists only for a version (co-constraints the web normalizer
/// enforces, portal-source.ts `normalizeStudentPortalDocument`); the
/// fixtures in EVOAdmissionsTests pin both shapes. There is NO separate
/// version-history RPC — `versionNo` is the honest version counter and the
/// UI shows exactly the latest file, like the web checklist.
struct StudentPortalDocumentRow: Decodable, Identifiable, Equatable {
    let caseId: UUID
    let documentSlotId: UUID
    let requirementKey: String?
    let requirementLabel: String
    let instructions: String?
    /// required | submitted | approved | correction_required | rejected
    /// (platform.document_slot_status, platform-private-documents.ts:10-16).
    let slotStatus: String
    let deadline: String?
    let nextAction: String?
    let documentVersionId: UUID?
    let versionNo: Int64?
    let originalFilename: String?
    /// application/pdf | image/jpeg | image/png (upload contract).
    let declaredMimeType: String?
    let byteSize: Int64?
    let submittedAt: String?
    /// approved | correction_required | rejected
    /// (platform.document_review_decision, platform-private-documents.ts:17-21).
    let reviewDecision: String?
    let reworkReason: String?
    let reviewedAt: String?

    var id: UUID { documentSlotId }

    enum CodingKeys: String, CodingKey {
        case caseId = "case_id"
        case documentSlotId = "document_slot_id"
        case requirementKey = "requirement_key"
        case requirementLabel = "requirement_label"
        case instructions
        case slotStatus = "slot_status"
        case deadline
        case nextAction = "next_action"
        case documentVersionId = "document_version_id"
        case versionNo = "version_no"
        case originalFilename = "original_filename"
        case declaredMimeType = "declared_mime_type"
        case byteSize = "byte_size"
        case submittedAt = "submitted_at"
        case reviewDecision = "review_decision"
        case reworkReason = "rework_reason"
        case reviewedAt = "reviewed_at"
    }

    /// Same rule as the web checklist: an approved slot is download-only
    /// (`allowUpload = status !== "approved"`, DocumentsView.tsx:170).
    var allowsUpload: Bool { slotStatus != "approved" }
}

/// Accepted-counter facts of the web checklist header
/// (presentation.ts `documentProgress`).
enum AdmissionDocumentProgress {
    static func approvedCount(_ documents: [StudentPortalDocumentRow]) -> Int {
        documents.filter { $0.slotStatus == "approved" }.count
    }

    static func inReviewCount(_ documents: [StudentPortalDocumentRow]) -> Int {
        documents.filter { $0.slotStatus == "submitted" }.count
    }

    static func correctionsCount(_ documents: [StudentPortalDocumentRow]) -> Int {
        documents.filter {
            $0.slotStatus == "correction_required" || $0.slotStatus == "rejected"
        }.count
    }

    static func missingCount(_ documents: [StudentPortalDocumentRow]) -> Int {
        documents.filter { $0.slotStatus == "required" }.count
    }
}

// MARK: - Finance (127:472-485; 189 null semantics)

/// One payment obligation. Migration 189 widened `due_at` to honest NULL:
/// a case-agreement tranche may be undated («срок при необходимости») —
/// NULL means UNDATED, not unknown, and the UI simply draws no due line
/// (PaymentsView.tsx:64-68). `nextAction` NULL means no next-step block.
/// No invented defaults anywhere.
struct StudentPortalPaymentRow: Decodable, Equatable {
    let obligationLabel: String
    /// evo_service_fee | third_party_cost
    /// (platform.obligation_category, platform-case-operations-contract.ts:12-15).
    let category: String
    let amountMinor: Int64
    let paidMinor: Int64
    let refundedMinor: Int64
    let outstandingMinor: Int64
    /// ISO 4217, e.g. KGS/USD.
    let currency: String
    /// The ONE allowed portal null-tolerance exception (189).
    let dueAt: String?
    /// pending | partially_paid | paid | overdue
    /// (platform.obligation_status, platform-case-operations-contract.ts:17-22).
    let derivedStatus: String
    /// SQL-computed, NULL-safe since 189:242-257 (undated is never overdue).
    let overdue: Bool
    let nextAction: String?

    enum CodingKeys: String, CodingKey {
        case obligationLabel = "obligation_label"
        case category
        case amountMinor = "amount_minor"
        case paidMinor = "paid_minor"
        case refundedMinor = "refunded_minor"
        case outstandingMinor = "outstanding_minor"
        case currency
        case dueAt = "due_at"
        case derivedStatus = "derived_status"
        case overdue
        case nextAction = "next_action"
    }
}

/// Pure rendering policy for the 189 null semantics: what the payment row
/// SHOWS, kept out of the view so it is testable headlessly.
enum AdmissionPaymentPolicy {
    /// A due line renders only for a dated obligation; NULL due_at draws
    /// nothing (never «не указан», never today's date).
    static func showsDueLine(_ payment: StudentPortalPaymentRow) -> Bool {
        payment.dueAt != nil
    }

    /// The refunded amount line renders only when something was refunded
    /// (PaymentsView.tsx:92).
    static func showsRefundedLine(_ payment: StudentPortalPaymentRow) -> Bool {
        payment.refundedMinor > 0
    }

    /// The next-step block renders only when the RPC published one.
    static func showsNextAction(_ payment: StudentPortalPaymentRow) -> Bool {
        payment.nextAction != nil
    }
}

// MARK: - Notifications (153:97-106) + mark-read (153:210, receipt 153:314-318)

struct StudentPortalNotificationRow: Decodable, Identifiable, Equatable {
    let notificationId: UUID
    /// Durable category code, e.g. document.review / payment.overdue /
    /// case_help.answer (projections 108/069/153).
    let category: String
    /// review decision text, 'overdue', or 'case_help_answer' (153:136-201).
    let eventCode: String
    let subjectLabel: String
    let detail: String?
    let dueAt: String?
    let createdAt: String
    let readAt: String?

    var id: UUID { notificationId }
    var isUnread: Bool { readAt == nil }

    enum CodingKeys: String, CodingKey {
        case notificationId = "notification_id"
        case category
        case eventCode = "event_code"
        case subjectLabel = "subject_label"
        case detail
        case dueAt = "due_at"
        case createdAt = "created_at"
        case readAt = "read_at"
    }
}

/// Receipt of `mark_own_student_portal_notification_read_v2`
/// (jsonb_build_object, 153:314-318). A replay of the same request_id
/// returns the original receipt (replay_audit, 153:283-291).
struct NotificationReadReceipt: Decodable, Equatable {
    let notificationId: UUID
    let isRead: Bool
    let readAt: String

    enum CodingKeys: String, CodingKey {
        case notificationId = "notification_id"
        case isRead = "is_read"
        case readAt = "read_at"
    }
}

/// Where a notification leads, mirroring the web's
/// `portalNotificationTarget` (presentation.ts): category prefix decides,
/// with `case_help_answer` as the one event-code special case. Targets the
/// iPhone does not have yet degrade to HONEST DISCLOSURE, never a dead link.
enum AdmissionNotificationTarget: Equatable {
    /// document* → the documents screen.
    case documents
    /// payment* → the payments screen.
    case payments
    /// case_help_answer → the web has a dedicated reply page
    /// (/portal/notifications/[id]); this wave has no iOS screen for it, so
    /// the row shows the notification's own detail plus an honest "full
    /// reply lives in the web cabinet" line instead of a link.
    case caseHelpReplyDisclosure
    /// Everything else → the web routes to the overview; on iOS the list
    /// already lives inside «Моё поступление», so there is nothing to link.
    case none
}

/// Pure policies of the notifications screen: navigation targets, the
/// unread set for «прочитать все», and the deterministic replay-safe
/// request id.
enum AdmissionNotificationPolicy {
    static func target(category: String, eventCode: String) -> AdmissionNotificationTarget {
        if eventCode == "case_help_answer" { return .caseHelpReplyDisclosure }
        if category.hasPrefix("document") { return .documents }
        if category.hasPrefix("payment") { return .payments }
        return .none
    }

    /// «Отметить все прочитанными» mirrors the web exactly — no new RPC,
    /// the single-item command loops over every UNREAD id
    /// (src/app/(portal)/portal/notifications/page.tsx:21-30). Already-read
    /// rows are skipped, so a retry after a partial failure stays safe.
    static func unreadIds(_ notifications: [StudentPortalNotificationRow]) -> [UUID] {
        notifications.filter(\.isUnread).map(\.notificationId)
    }

    /// Bit-for-bit mirror of the web's deterministic command id
    /// (src/lib/server/student-portal-notification-command-id.ts): UUIDv5
    /// over the fixed namespace and the canonical (lowercase) actor +
    /// notification ids. One student + one notification = ONE replay-safe
    /// acknowledgement command, on every platform, on every retry.
    static func readRequestId(
        organizationId: UUID,
        studentCaseId: UUID,
        membershipId: UUID,
        authUserId: UUID,
        notificationId: UUID
    ) -> UUID {
        let name = [
            "notification-read",
            organizationId.uuidString.lowercased(),
            studentCaseId.uuidString.lowercased(),
            membershipId.uuidString.lowercased(),
            authUserId.uuidString.lowercased(),
            notificationId.uuidString.lowercased(),
        ].joined(separator: ":")
        return uuidV5(namespace: Self.commandNamespace, name: name)
    }

    /// STUDENT_PORTAL_COMMAND_NAMESPACE
    /// (student-portal-notification-command-id.ts:5-6).
    static let commandNamespace = UUID(uuidString: "73f89df8-d811-5352-9a97-a87652d591c1")!

    /// RFC 4122 v5 (SHA-1) — same algorithm the web helper hand-rolls.
    static func uuidV5(namespace: UUID, name: String) -> UUID {
        var data = withUnsafeBytes(of: namespace.uuid) { Data($0) }
        data.append(Data(name.utf8))
        var digest = Array(Insecure.SHA1.hash(data: data)).prefix(16).map { $0 }
        digest[6] = (digest[6] & 0x0F) | 0x50
        digest[8] = (digest[8] & 0x3F) | 0x80
        return UUID(uuid: (
            digest[0], digest[1], digest[2], digest[3],
            digest[4], digest[5], digest[6], digest[7],
            digest[8], digest[9], digest[10], digest[11],
            digest[12], digest[13], digest[14], digest[15]
        ))
    }
}

// MARK: - Shared display helpers

/// Money exactly like the web (`formatPortalMoney`, presentation.ts:62-68):
/// ru-RU currency formatting of minor units / 100, max 2 fraction digits —
/// the web renders ru-RU for BOTH locales, so iOS does too.
enum AdmissionMoney {
    static func label(minor: Int64, currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.currencyCode = currency
        formatter.maximumFractionDigits = 2
        return formatter.string(from: NSNumber(value: Double(minor) / 100))
            ?? "\(Double(minor) / 100) \(currency)"
    }
}

/// Timestamp exactly like the web (`formatPortalTimestamp`,
/// presentation.ts:47-60): dd.MM.yyyy, HH:mm in the portal's fixed
/// Asia/Bishkek timezone; unparseable input renders as nothing, never as a
/// fabricated date.
enum AdmissionTimestamp {
    static func label(from raw: String?) -> String? {
        guard let raw, let date = PostgresTimestamp.date(from: raw) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.timeZone = TimeZone(identifier: "Asia/Bishkek")
        formatter.dateFormat = "dd.MM.yyyy, HH:mm"
        return formatter.string(from: date)
    }
}
