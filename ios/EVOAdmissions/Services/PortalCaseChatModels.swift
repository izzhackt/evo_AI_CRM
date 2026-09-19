import Foundation

/// Codable mirrors of the STUDENT case-chat contracts in
/// `supabase/migrations/200_platform_portal_case_chat.sql` (the student door
/// into the per-case chat of migration 191 — same tables, same topic):
/// - `portal_case_chat_page_v1` (200:137-210) — before-cursor page of the
///   OWN thread; parameters never address a case (gate 192 resolves it)
/// - `portal_case_chat_post_v1` (200:49-132) — idempotent post by request_id
///   with a fingerprint over the body (200:80-90): a replay of the same
///   `(request_id, body)` returns the original receipt, a different body for
///   the same request_id is PT409.
///
/// Assisted tier only: both RPCs run the 192 case-operations gate (student +
/// own case in state active/closed); approved/pending gets 42501 — the UI
/// never shows this screen to the approved tier at all.

/// One message row (200:177-187). `sequenceId` is a BIGINT rendered as TEXT
/// (`m.sequence_id::TEXT`) — kept as the raw string and compared through
/// `sequenceValue`, never through lossy floating point.
///
/// Attachment contract (200:168-176 + §6 of the 191→200 integration
/// contract):
/// - `attachmentKind = 'document'`: label is the LIVE document slot's
///   requirement label, left(…, 300) — and NULL when the slot was removed;
///   the UI renders a neutral placeholder for NULL, never an invented name;
/// - `attachmentKind = 'case_task'`: the task title is NEVER resolved for
///   the student (`attachmentLabel` stays NULL by construction) and the UI
///   renders NO task card at all — body/quote/meta still render normally.
struct PortalCaseChatMessage: Decodable, Identifiable, Equatable {
    let id: UUID
    let sequenceId: String
    let mine: Bool
    let authorName: String
    let body: String
    /// timestamptz rendered into JSONB; raw string (see `PostgresTimestamp`).
    let createdAt: String
    let attachmentKind: String?
    let attachmentLabel: String?
    /// Server-truncated quote preview, left(…, 140) (200:186).
    let quotedBodyPreview: String?

    var sequenceValue: Int64 { Int64(sequenceId) ?? 0 }
    var isDocumentAttachment: Bool { attachmentKind == "document" }
}

/// Top-level page shape (200:206-209): messages arrive NEWEST FIRST
/// (`ORDER BY m.sequence_id DESC`, 200:187), `cursor` is the smallest
/// sequence_id of the batch (as TEXT), `hasMore` says whether an older page
/// exists, `awaitState` is the thread's live await state (never mutated by
/// reads, 200:26-29).
struct PortalCaseChatPage: Decodable {
    let messages: [PortalCaseChatMessage]
    let cursor: String
    let hasMore: Bool
    /// none | needs_reply | awaiting_student (191 thread contract).
    let awaitState: String
}

/// `portal_case_chat_post_v1` receipt (200:117-119):
/// `{requestId, studentCaseId, mode, messageId, sequenceId, createdAt}`.
struct PortalCaseChatPostReceipt: Decodable {
    let requestId: UUID
    let studentCaseId: UUID
    let mode: String
    let messageId: UUID
    let sequenceId: String
    let createdAt: String
}

/// Pure thread-assembly policy (mirrors the web's
/// `mergePortalCaseMessages`, src/lib/portal/messages.ts): pages and polls
/// merge into ONE ascending list, deduplicated by sequenceId — polling
/// refreshes only the newest page and must never drop or reorder the older
/// pages already loaded.
enum PortalCaseChatPolicy {
    /// Body limit of the student post (200:70-73: 1..2000 after btrim).
    static let bodyLimit = 2000

    /// Union of `existing` and `incoming` by sequenceId, sorted ascending
    /// (oldest first — chat display order). Incoming rows win on collision
    /// so a refreshed row (same sequenceId) replaces its stale copy.
    static func merge(
        _ existing: [PortalCaseChatMessage],
        _ incoming: [PortalCaseChatMessage]
    ) -> [PortalCaseChatMessage] {
        var bySequence: [String: PortalCaseChatMessage] = [:]
        for message in existing { bySequence[message.sequenceId] = message }
        for message in incoming { bySequence[message.sequenceId] = message }
        return bySequence.values.sorted { left, right in
            left.sequenceValue == right.sequenceValue
                ? left.sequenceId < right.sequenceId
                : left.sequenceValue < right.sequenceValue
        }
    }

    /// Whether a draft is sendable (the same trim rule as the server's
    /// btrim + 1..2000 CHECK, 200:67-73).
    static func isSendable(draft: String, isSending: Bool) -> Bool {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return !isSending && !trimmed.isEmpty && trimmed.count <= bodyLimit
    }
}
