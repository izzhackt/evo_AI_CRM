import SwiftUI

/// «Моё поступление» (assisted) — хаб сопровождения, волна 8: статус кейса,
/// очередь действий студента из `student_portal_overview_v2` (131:17-30) +
/// финансовых начислений (правило слияния/сортировки — зеркало веба,
/// portal-source.ts:674-691, `AdmissionActionPolicy`), колонка EVO
/// (задача + куратор) и входы в Документы / Оплату / Уведомления /
/// Сообщения. Всё по данным — read-only; прежняя строка «доступны в
/// веб-кабинете» удалена: разделы теперь живут здесь.
@MainActor
final class AdmissionHubModel: ObservableObject {
    @Published private(set) var overview: StudentPortalOverviewRow?
    @Published private(set) var actions: [AdmissionAction] = []
    @Published private(set) var isLoaded = false
    @Published private(set) var loadFailed = false

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    var primaryAction: AdmissionAction? { actions.first }
    var remainingActions: [AdmissionAction] { Array(actions.dropFirst()) }

    func load() async {
        loadFailed = false
        do {
            // Как в вебе: обзор и финансы читаются вместе — очередь действий
            // объединяет document-action и неоплаченные начисления.
            async let overviewRow = service.studentPortalOverview()
            async let payments = service.studentPortalFinance()
            let (row, financeRows) = try await (overviewRow, payments)
            overview = row
            actions = AdmissionActionPolicy.queue(
                documentAction: row?.documentAction,
                payments: financeRows
            )
            isLoaded = true
        } catch {
            overview = nil
            actions = []
            isLoaded = false
            loadFailed = true
        }
    }
}

struct MyAdmissionView: View {
    let session: SessionRouter.PortalSession
    @StateObject private var model = AdmissionHubModel()

    private var statusKey: LocalizedStringKey {
        switch session.portalCase.caseState {
        case "pending": return "case_status_pending"
        case "active": return "case_status_active"
        case "closed": return "case_status_closed"
        default: return "case_status_unknown"
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent {
                        Text(statusKey)
                    } label: {
                        Text("home_case_status_label")
                    }
                    if let stage = model.overview.flatMap({ AdmissionStageLabel.key(for: $0.operationalStage) }) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("adm_stage_label")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(stage)
                                .font(.headline)
                        }
                        .accessibilityElement(children: .combine)
                    }
                    if let nextAction = session.portalCase.nextAction, !nextAction.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("home_next_action_label")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(nextAction)
                                .font(.subheadline)
                        }
                    }
                }

                nextStepSection

                evoSection

                Section {
                    NavigationLink {
                        AdmissionDocumentsView()
                    } label: {
                        Label("adm_documents_title", systemImage: "doc.text")
                    }
                    NavigationLink {
                        AdmissionPaymentsView()
                    } label: {
                        Label("adm_payments_title", systemImage: "creditcard")
                    }
                    NavigationLink {
                        AdmissionNotificationsView(session: session)
                    } label: {
                        Label("adm_notifications_title", systemImage: "bell")
                    }
                    NavigationLink {
                        MessagesThreadView()
                    } label: {
                        Label("messages_title", systemImage: "bubble.left.and.text.bubble.right")
                    }
                } footer: {
                    Text("messages_section_note")
                }
            }
            .navigationTitle("tab_my_admission")
            .refreshable { await model.load() }
            .task {
                if !model.isLoaded {
                    await model.load()
                }
            }
        }
    }

    // MARK: - Следующий шаг (обзор 131 + очередь действий)

    @ViewBuilder
    private var nextStepSection: some View {
        Section {
            if model.isLoaded {
                if let primary = model.primaryAction {
                    AdmissionActionRow(action: primary, isPrimary: true)
                } else {
                    // Честное «спокойное» состояние: план есть, действий нет —
                    // или обзор ещё не опубликован (нет строки).
                    Text(model.overview == nil ? "adm_calm_no_plan" : "adm_calm_done")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                ForEach(Array(model.remainingActions.enumerated()), id: \.offset) { _, action in
                    AdmissionActionRow(action: action, isPrimary: false)
                }
            } else if model.loadFailed {
                VStack(alignment: .leading, spacing: 8) {
                    Text("adm_section_unavailable")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("retry_button") {
                        Task { await model.load() }
                    }
                    .font(.subheadline)
                }
            } else {
                ProgressView()
            }
        } header: {
            Text("adm_next_step_heading")
        } footer: {
            if model.isLoaded, model.primaryAction != nil {
                Text("adm_next_step_note")
            }
        }
    }

    // MARK: - Команда EVO (evo_action + куратор)

    @ViewBuilder
    private var evoSection: some View {
        if model.isLoaded {
            Section("adm_evo_heading") {
                if let evoAction = model.overview?.evoAction {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(evoAction.title)
                            .font(.subheadline)
                        HStack(spacing: 8) {
                            Text(evoTaskStatusKey(evoAction.status))
                                .font(.caption.weight(.medium))
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(
                                    Color("AccentColor").opacity(0.08),
                                    in: Capsule()
                                )
                            if let due = evoDueLabel(evoAction) {
                                (Text("adm_due_term") + Text(verbatim: " \(due)"))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } else {
                    Text("adm_evo_empty")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                LabeledContent {
                    if let curator = model.overview?.curatorDisplayName {
                        Text(curator)
                    } else {
                        Text("adm_curator_empty")
                            .foregroundStyle(.secondary)
                    }
                } label: {
                    Text("adm_curator_heading")
                }
            }
        }
    }

    /// open/in_progress → «в работе», blocked → «заблокирована» — те же
    /// доменные подписи, что в веб-словаре admission (i18n.ts taskStatus.*);
    /// неожиданный runtime-статус — честное «статус недоступен».
    private func evoTaskStatusKey(_ status: String) -> LocalizedStringKey {
        switch status {
        case "open", "in_progress": return "adm_task_status_in_progress"
        case "blocked": return "adm_task_status_blocked"
        default: return "adm_status_unavailable"
        }
    }

    /// due_on (DATE, весь день) ИЛИ due_at (timestamptz) — как
    /// evoActionDueLabel в вебе (presentation.ts:85-89).
    private func evoDueLabel(_ action: EvoAction) -> String? {
        if let dueOn = action.dueOn {
            return CatalogDate.dayLabel(from: dueOn, locale: AppLocale.current)
        }
        return AdmissionTimestamp.label(from: action.dueAt)
    }
}

/// Одна строка очереди действий: глагол + предмет, срок (или честное «Не
/// указан»), сумма для оплаты; ведёт в свой раздел.
struct AdmissionActionRow: View {
    let action: AdmissionAction
    let isPrimary: Bool

    var body: some View {
        NavigationLink {
            switch action.kind {
            case .payment:
                AdmissionPaymentsView()
            case .uploadDocument, .replaceDocument:
                AdmissionDocumentsView()
            }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                (Text(verbKey) + Text(verbatim: ": \(action.label)"))
                    .font(isPrimary ? .subheadline.weight(.semibold) : .subheadline)
                HStack(spacing: 10) {
                    if let due = AdmissionTimestamp.label(from: action.dueAt) {
                        (Text("adm_due_term") + Text(verbatim: " \(due)"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        (Text("adm_due_term") + Text(verbatim: " ") + Text("adm_due_unknown"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if action.kind == .payment, let amount = action.amountMinor, let currency = action.currency {
                        (Text("adm_amount_term")
                            + Text(verbatim: " \(AdmissionMoney.label(minor: amount, currency: currency))"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var verbKey: LocalizedStringKey {
        switch action.kind {
        case .uploadDocument: return "adm_action_upload"
        case .replaceDocument: return "adm_action_replace"
        case .payment: return "adm_action_payment"
        }
    }
}

/// Shared web/iPhone stage vocabulary; absent values are not invented.
enum AdmissionStageLabel {
    static func key(for stage: String) -> LocalizedStringKey? {
        let value = stage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        switch value {
        case "contract_confirmed": return "adm_stage_contract_confirmed"
        case "admissions_handoff": return "adm_stage_admissions_handoff"
        case "intake": return "adm_stage_intake"
        case "profile_and_route": return "adm_stage_profile_and_route"
        case "documents": return "adm_stage_documents"
        case "applications": return "adm_stage_applications"
        case "decisions": return "adm_stage_decisions"
        case "visa_and_predeparture": return "adm_stage_visa_and_predeparture"
        case "arrival_and_adaptation": return "adm_stage_arrival_and_adaptation"
        case "completed": return "adm_stage_completed"
        case "closed": return "adm_stage_closed"
        default: return "adm_stage_custom"
        }
    }
}
