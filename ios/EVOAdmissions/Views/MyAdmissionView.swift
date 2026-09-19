import SwiftUI

/// «Моё поступление» (assisted): статус кейса + вход в «Сообщения»
/// (миграция 200). Остальные разделы сопровождения (документы, оплата,
/// уведомления — веб-разделы PORT-5d) на iPhone ещё не построены, о чём
/// экран говорит честно, ничего не имитируя.
struct MyAdmissionView: View {
    let session: SessionRouter.PortalSession

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

                Section {
                    NavigationLink {
                        MessagesThreadView()
                    } label: {
                        Label("messages_title", systemImage: "bubble.left.and.text.bubble.right")
                    }
                } footer: {
                    Text("messages_section_note")
                }

                Section {
                    // Честная граница волны: разделы читаются в веб-кабинете.
                    Text("admission_next_wave")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("tab_my_admission")
        }
    }
}
