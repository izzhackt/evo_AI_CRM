import SwiftUI

/// «Оплата» — iOS-паритет веб-PaymentsView.tsx: те же начисления из
/// `student_portal_finance_v2` (127:472-485), null-семантика 189 сохранена
/// (dueAt NULL = «без срока» — строка срока просто не рисуется; nextAction
/// NULL — блока «Следующий шаг» нет). Суммы — в minor units, формат денег
/// как в вебе (ru-RU для обеих локалей).
@MainActor
final class AdmissionPaymentsModel: ObservableObject {
    @Published private(set) var payments: [StudentPortalPaymentRow] = []
    @Published private(set) var isLoaded = false
    @Published private(set) var loadFailed = false

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func load() async {
        loadFailed = false
        do {
            payments = try await service.studentPortalFinance()
            isLoaded = true
        } catch {
            loadFailed = true
        }
    }
}

struct AdmissionPaymentsView: View {
    @StateObject private var model = AdmissionPaymentsModel()

    var body: some View {
        Group {
            if model.isLoaded {
                if model.payments.isEmpty {
                    VStack(spacing: 6) {
                        Text("adm_payments_empty_title")
                            .font(.headline)
                        Text("adm_payments_empty_body")
                            .font(.subheadline)
                            .foregroundStyle(.secondaryText)
                            .multilineTextAlignment(.center)
                    }
                    .padding(32)
                } else {
                    List {
                        Section {
                            ForEach(Array(model.payments.enumerated()), id: \.offset) { _, payment in
                                PaymentRow(payment: payment)
                            }
                        } header: {
                            Text("adm_payments_heading")
                                .foregroundStyle(.secondaryText)
                        } footer: {
                            Text("adm_bishkek_note")
                                .foregroundStyle(.secondaryText)
                        }
                    }
                    .refreshable { await model.load() }
                }
            } else if model.loadFailed {
                VStack(spacing: 12) {
                    Text("adm_section_unavailable")
                        .multilineTextAlignment(.center)
                    Button("retry_button") {
                        Task { await model.load() }
                    }
                    .accentBordered()
                }
                .padding(32)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("adm_payments_title")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if !model.isLoaded {
                await model.load()
            }
        }
    }
}

private struct PaymentRow: View {
    let payment: StudentPortalPaymentRow

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(payment.obligationLabel)
                        .font(.subheadline.weight(.semibold))
                    if let category = categoryKey {
                        Text(category)
                            .font(.caption)
                            .foregroundStyle(.secondaryText)
                    }
                    // 189: NULL due_at = «без срока» — строки срока нет.
                    if AdmissionPaymentPolicy.showsDueLine(payment),
                       let due = AdmissionTimestamp.label(from: payment.dueAt) {
                        (Text("adm_due_term") + Text(verbatim: " \(due)"))
                            .font(.caption)
                            .foregroundStyle(.secondaryText)
                    }
                }
                Spacer(minLength: 8)
                statusPill
            }

            VStack(alignment: .leading, spacing: 3) {
                amountRow(term: "adm_to_pay_term", minor: payment.amountMinor)
                amountRow(term: "adm_paid_term", minor: payment.paidMinor)
                amountRow(term: "adm_outstanding_term", minor: payment.outstandingMinor)
                if AdmissionPaymentPolicy.showsRefundedLine(payment) {
                    amountRow(term: "adm_refunded_term", minor: payment.refundedMinor)
                }
            }

            if AdmissionPaymentPolicy.showsNextAction(payment), let nextAction = payment.nextAction {
                (Text("adm_next_step_label") + Text(verbatim: " ") + Text(verbatim: nextAction))
                    .font(.footnote)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    private func amountRow(term: LocalizedStringKey, minor: Int64) -> some View {
        HStack {
            Text(term)
                .font(.caption)
                .foregroundStyle(.secondaryText)
            Spacer()
            Text(AdmissionMoney.label(minor: minor, currency: payment.currency))
                .font(.callout.monospacedDigit())
        }
    }

    // pending | partially_paid | paid | overdue — те же доменные подписи и
    // тона, что в вебе (payStatus.* + paymentStatus, presentation.ts).
    // Текст метки основным цветом, тон у заливки и значка: зелёный по
    // зелёному давал 2,0:1, серый по серому 3,3:1 (аудит UX/UI 2026-10).
    private var statusPill: some View {
        StatusBadge(Text(statusKey), systemImage: statusSymbol, tone: statusTone)
    }

    private var statusKey: LocalizedStringKey {
        switch payment.derivedStatus {
        case "pending": return "adm_pay_status_pending"
        case "partially_paid": return "adm_pay_status_partially_paid"
        case "paid": return "adm_pay_status_paid"
        case "overdue": return "adm_pay_status_overdue"
        default: return "adm_status_unavailable"
        }
    }

    private var isOverdue: Bool {
        payment.overdue || payment.derivedStatus == "overdue"
    }

    private var statusTone: StatusBadge.Tone {
        if payment.derivedStatus == "paid" { return .success }
        if isOverdue { return .danger }
        if payment.derivedStatus == "partially_paid" { return .warning }
        return .neutral
    }

    private var statusSymbol: String {
        if payment.derivedStatus == "paid" { return "checkmark.circle.fill" }
        if isOverdue { return "exclamationmark.circle.fill" }
        if payment.derivedStatus == "partially_paid" { return "circle.lefthalf.filled" }
        return "clock"
    }

    private var categoryKey: LocalizedStringKey? {
        switch payment.category {
        case "evo_service_fee": return "adm_pay_category_evo_service_fee"
        case "third_party_cost": return "adm_pay_category_third_party_cost"
        default: return nil
        }
    }
}
