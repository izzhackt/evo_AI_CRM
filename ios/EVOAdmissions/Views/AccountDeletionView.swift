import SwiftUI

/// «Удалить аккаунт» (миграция 280, решения владельца 07.10.2026, App Store
/// 5.1.1(v)): любой вошедший аккаунт, в том числе анкета без одобрения.
/// Статус приходит с сервера (`own_account_deletion_request_v1`), поэтому
/// «запрос принят» переживает перезапуск и виден на другом устройстве.
/// request_id стабилен на модель: повтор нажатия и сбой сети возвращают тот
/// же открытый запрос.
@MainActor
final class AccountDeletionModel: ObservableObject {
    @Published private(set) var request: OwnAccountDeletion?
    @Published private(set) var loadFailed = false
    @Published private(set) var isLoading = false
    @Published private(set) var isSending = false
    @Published private(set) var sendFailed = false

    private let service: SupabaseService
    private let requestId = UUID()

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func load() async {
        if isLoading { return }
        isLoading = true
        do {
            request = try await service.ownAccountDeletionRequest()
            loadFailed = false
        } catch {
            loadFailed = true
        }
        isLoading = false
    }

    func send() async {
        guard !isSending else { return }
        isSending = true
        sendFailed = false
        do {
            request = try await service.requestAccountDeletion(requestId: requestId)
            loadFailed = false
        } catch {
            sendFailed = true
        }
        isSending = false
    }
}

/// Строки раздела для `List`/`Form`: объяснение, кнопка с подтверждением,
/// затем статус запроса. Используется в «Профиле» и в листе удаления.
struct AccountDeletionContent: View {
    @ObservedObject var model: AccountDeletionModel
    /// В листе заголовок уже стоит в навигации — второй не нужен.
    var showsHeader = true
    @State private var showsConfirm = false

    var body: some View {
        Section {
            if let request = model.request {
                statusRows(request)
            } else if model.loadFailed {
                Text("account_deletion_unavailable")
                    .font(.footnote)
                    .foregroundStyle(.red)
            } else {
                Button(role: .destructive) {
                    showsConfirm = true
                } label: {
                    if model.isSending {
                        ProgressView()
                    } else {
                        Text("account_deletion_action")
                    }
                }
                .disabled(model.isSending || model.isLoading)
                // A11y: во время отправки label — ProgressView без текста.
                .accessibilityLabel(Text("account_deletion_action"))
                .accessibilityIdentifier("account-deletion-start")
                // Подтверждение привязано к самой кнопке: модификатор на
                // Section внутри List в листе не показывается.
                .confirmationDialog(
                    "account_deletion_confirm_question",
                    isPresented: $showsConfirm,
                    titleVisibility: .visible
                ) {
                    Button("account_deletion_confirm_yes", role: .destructive) {
                        Task { await model.send() }
                    }
                    Button("cancel_button", role: .cancel) {}
                } message: {
                    Text("account_deletion_confirm_note")
                }
                if model.sendFailed {
                    Text("account_deletion_error")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }
        } header: {
            if showsHeader {
                Text("account_deletion_heading")
            }
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if model.request == nil {
                    Text("account_deletion_description")
                }
                Text("account_deletion_kept_note")
            }
        }
    }

    @ViewBuilder
    private func statusRows(_ request: OwnAccountDeletion) -> some View {
        if request.isProcessing {
            Label("account_deletion_processing", systemImage: "hourglass")
                .font(.subheadline)
                .accessibilityIdentifier("account-deletion-status")
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Label {
                    Text(String(
                        format: String(localized: "account_deletion_requested"),
                        AccountDeletionPolicy.dayLabel(from: request.requestedAt) ?? String(request.requestedAt.prefix(10))
                    ))
                    .font(.subheadline.weight(.semibold))
                } icon: {
                    Image(systemName: "checkmark.circle")
                }
                .motionBounceOnAppear()
                Text(String(
                    format: String(localized: "account_deletion_due"),
                    AccountDeletionPolicy.dayLabel(from: request.dueAt) ?? String(request.dueAt.prefix(10))
                ))
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("account-deletion-status")
        }
    }
}

/// Лист «Удаление аккаунта» для экранов без вкладки «Профиль»: анкета,
/// статус заявки, ожидание доступа.
struct AccountDeletionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = AccountDeletionModel()

    var body: some View {
        NavigationStack {
            List {
                AccountDeletionContent(model: model, showsHeader: false)
            }
            .navigationTitle("account_deletion_heading")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("account_deletion_done_button") { dismiss() }
                }
            }
            .task { await model.load() }
            .refreshable { await model.load() }
        }
    }
}
