import SwiftUI

/// «Уведомления» — iOS-паритет веб-NotificationsView.tsx:
/// - список из `student_portal_notifications_v2` (153:97-106, cap 500),
///   непрочитанные подсвечены;
/// - «прочитано» — replay-safe команда
///   `mark_own_student_portal_notification_read_v2` с ДЕТЕРМИНИРОВАННЫМ
///   request_id (UUIDv5-формула веба, AdmissionNotificationPolicy);
/// - «отметить все» — цикл той же одиночной команды по непрочитанным
///   (веб: notifications/page.tsx:21-30, нового RPC нет);
/// - навигация — зеркало portalNotificationTarget: document* → Документы,
///   payment* → Оплата, case_help_answer → честное раскрытие (полный ответ
///   куратора — веб-страница, iOS-экрана в этой волне нет; мёртвых ссылок
///   нет), прочее — без ссылки (объект — сам хаб).
@MainActor
final class AdmissionNotificationsModel: ObservableObject {
    @Published private(set) var notifications: [StudentPortalNotificationRow] = []
    @Published private(set) var isLoaded = false
    @Published private(set) var loadFailed = false
    @Published private(set) var markingIds: Set<UUID> = []
    @Published private(set) var failedIds: Set<UUID> = []
    @Published private(set) var isMarkingAll = false
    @Published private(set) var markAllFailed = false

    private let service: SupabaseService
    private let session: SessionRouter.PortalSession

    init(session: SessionRouter.PortalSession, service: SupabaseService = .shared) {
        self.session = session
        self.service = service
    }

    var hasUnread: Bool {
        notifications.contains(where: \.isUnread)
    }

    func load() async {
        loadFailed = false
        do {
            notifications = try await service.studentPortalNotifications()
            isLoaded = true
        } catch {
            loadFailed = true
        }
    }

    func markRead(_ notificationId: UUID) async {
        guard !markingIds.contains(notificationId) else { return }
        markingIds.insert(notificationId)
        failedIds.remove(notificationId)
        defer { markingIds.remove(notificationId) }
        do {
            let receipt = try await service.markNotificationRead(
                notificationId: notificationId,
                requestId: requestId(for: notificationId)
            )
            apply(receipt: receipt)
        } catch {
            failedIds.insert(notificationId)
        }
    }

    /// Цикл одиночной команды по всем непрочитанным; детерминированный
    /// request_id делает повтор после частичного сбоя безопасным — уже
    /// прочитанные вернут исходный receipt через replay_audit.
    func markAllRead() async {
        guard !isMarkingAll else { return }
        isMarkingAll = true
        markAllFailed = false
        defer { isMarkingAll = false }
        var anyFailed = false
        for notificationId in AdmissionNotificationPolicy.unreadIds(notifications) {
            do {
                let receipt = try await service.markNotificationRead(
                    notificationId: notificationId,
                    requestId: requestId(for: notificationId)
                )
                apply(receipt: receipt)
            } catch {
                anyFailed = true
            }
        }
        markAllFailed = anyFailed
    }

    private func requestId(for notificationId: UUID) -> UUID {
        AdmissionNotificationPolicy.readRequestId(
            organizationId: session.authority.organizationId,
            studentCaseId: session.portalCase.id,
            membershipId: session.authority.membershipId,
            authUserId: session.authority.authUserId,
            notificationId: notificationId
        )
    }

    private func apply(receipt: NotificationReadReceipt) {
        guard receipt.isRead else { return }
        notifications = notifications.map { row in
            guard row.notificationId == receipt.notificationId else { return row }
            return StudentPortalNotificationRow(
                notificationId: row.notificationId,
                category: row.category,
                eventCode: row.eventCode,
                subjectLabel: row.subjectLabel,
                detail: row.detail,
                dueAt: row.dueAt,
                createdAt: row.createdAt,
                readAt: receipt.readAt
            )
        }
    }
}

struct AdmissionNotificationsView: View {
    let session: SessionRouter.PortalSession
    @StateObject private var model: AdmissionNotificationsModel

    init(session: SessionRouter.PortalSession) {
        self.session = session
        _model = StateObject(
            wrappedValue: AdmissionNotificationsModel(session: session)
        )
    }

    var body: some View {
        Group {
            if model.isLoaded {
                if model.notifications.isEmpty {
                    VStack(spacing: 6) {
                        Text("adm_notifications_empty_title")
                            .font(.headline)
                        Text("adm_notifications_empty_body")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(32)
                } else {
                    notificationsList
                }
            } else if model.loadFailed {
                VStack(spacing: 12) {
                    Text("adm_section_unavailable")
                        .multilineTextAlignment(.center)
                    Button("retry_button") {
                        Task { await model.load() }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(32)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("adm_notifications_title")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if !model.isLoaded {
                await model.load()
            }
        }
        .toolbar {
            if model.isLoaded, model.hasUnread {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.markAllRead() }
                    } label: {
                        if model.isMarkingAll {
                            ProgressView()
                        } else {
                            Text("adm_mark_all_read")
                        }
                    }
                    .disabled(model.isMarkingAll)
                    .accessibilityLabel(Text("adm_mark_all_read"))
                }
            }
        }
    }

    private var notificationsList: some View {
        List {
            Section {
                if model.markAllFailed {
                    Text("adm_mark_error")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
                ForEach(model.notifications) { notification in
                    NotificationRow(
                        notification: notification,
                        isMarking: model.markingIds.contains(notification.notificationId),
                        markFailed: model.failedIds.contains(notification.notificationId),
                        onMarkRead: {
                            Task { await model.markRead(notification.notificationId) }
                        }
                    )
                }
            } footer: {
                Text("adm_notifications_time_note")
            }
        }
        .refreshable { await model.load() }
    }
}

private struct NotificationRow: View {
    let notification: StudentPortalNotificationRow
    let isMarking: Bool
    let markFailed: Bool
    let onMarkRead: () -> Void

    private var target: AdmissionNotificationTarget {
        AdmissionNotificationPolicy.target(
            category: notification.category,
            eventCode: notification.eventCode
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                Text(notification.subjectLabel)
                    .font(notification.isUnread ? .subheadline.weight(.semibold) : .subheadline)
                Spacer(minLength: 8)
                if notification.isUnread {
                    Text("adm_status_new")
                        .font(.caption.weight(.medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.blue.opacity(0.12), in: Capsule())
                        .foregroundStyle(.blue)
                }
            }

            if let detail = notification.detail {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            metaLine

            targetView

            if notification.isUnread {
                HStack(spacing: 8) {
                    Button {
                        onMarkRead()
                    } label: {
                        if isMarking {
                            HStack(spacing: 6) {
                                ProgressView()
                                Text("adm_marking")
                            }
                        } else {
                            Text("adm_mark_read")
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isMarking)
                    .accessibilityLabel(Text("adm_mark_read"))
                    if markFailed {
                        Text("adm_mark_error")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var metaLine: some View {
        var parts: [String] = []
        if let created = AdmissionTimestamp.label(from: notification.createdAt) {
            parts.append(created)
        } else {
            parts.append(String(localized: "adm_date_unavailable"))
        }
        if let due = AdmissionTimestamp.label(from: notification.dueAt) {
            parts.append("\(String(localized: "adm_due_meta")) \(due)")
        }
        return Text(verbatim: parts.joined(separator: " · "))
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    /// Зеркало portalNotificationTarget: реальный объект или честное
    /// раскрытие — никогда не мёртвая ссылка.
    @ViewBuilder
    private var targetView: some View {
        switch target {
        case .documents:
            NavigationLink {
                AdmissionDocumentsView()
            } label: {
                Text("adm_target_documents")
                    .font(.footnote)
            }
            .accessibilityLabel(Text("adm_target_documents"))
        case .payments:
            NavigationLink {
                AdmissionPaymentsView()
            } label: {
                Text("adm_target_payments")
                    .font(.footnote)
            }
            .accessibilityLabel(Text("adm_target_payments"))
        case .caseHelpReplyDisclosure:
            // Полный ответ куратора — веб-страница; iOS-экрана в этой волне
            // нет, и мы честно говорим об этом вместо мёртвой ссылки.
            Text("adm_reply_web_note")
                .font(.caption)
                .foregroundStyle(.secondary)
        case .none:
            EmptyView()
        }
    }
}
