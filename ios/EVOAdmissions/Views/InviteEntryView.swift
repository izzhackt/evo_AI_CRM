import SwiftUI

/// PORT-9a: нативный приём приглашения «не выходя из приложения»
/// (ADR 0030 «Решение» п. 3(б)). Письмо ведёт на web-callback
/// (`…/auth/callback?token_hash=<56hex>&type=invite`); сюда вставляется сама
/// ссылка или токен из неё. Шаги зеркалят веб: явное подтверждение (кнопка,
/// как интерстициал callback'а) → verifyOTP тем же Auth-вызовом → отметка
/// receipt'а через POST /api/portal/invite-acceptance → установка пароля тем
/// же updateUser — затем честная маршрутизация (anketa_v1 → анкета).
@MainActor
final class InviteEntryViewModel: ObservableObject {
    enum Phase: Equatable {
        case enterToken
        case verifying
        /// verifyOTP прошёл, но отметка receipt'а не удалась по сети/серверу —
        /// повтор ретраит ТОЛЬКО acceptance (токен уже потреблён).
        case acceptanceRetry
        case setPassword(displayName: String?)
        case saving
    }

    @Published var phase: Phase = .enterToken
    @Published var pasted = ""
    @Published var password = ""
    @Published var confirm = ""
    @Published var errorKey: String?
    @Published var showPassword = false

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func verify() async {
        errorKey = nil
        guard let tokenHash = InviteLinkPolicy.tokenHash(fromPastedText: pasted) else {
            errorKey = "apply_invite_invalid_link"
            return
        }
        phase = .verifying
        do {
            try await service.verifyStudentInviteToken(tokenHash: tokenHash)
        } catch let error as URLError {
            errorKey = error.code == .notConnectedToInternet || error.code == .timedOut
                ? "apply_invite_unavailable" : "apply_invite_expired"
            phase = .enterToken
            return
        } catch {
            // Supabase Auth отклонил токен: истёк или уже использован — та же
            // формулировка, что у веб-callback'а (StudentInviteCallback.tsx).
            errorKey = "apply_invite_expired"
            phase = .enterToken
            return
        }
        await accept()
    }

    func accept() async {
        errorKey = nil
        phase = .verifying
        do {
            switch try await service.acceptStudentInvite() {
            case let .accepted(receipt):
                phase = .setPassword(displayName: receipt.displayName)
            case .mismatch:
                // Сессия не соответствует ни одному receipt'у — как
                // invalid_identity на вебе: локальный выход и честная ошибка.
                try? await service.signOut()
                errorKey = "apply_invite_mismatch"
                phase = .enterToken
            case .authenticationRequired, .unavailable:
                errorKey = "apply_invite_unavailable"
                phase = .acceptanceRetry
            }
        } catch {
            errorKey = "apply_invite_unavailable"
            phase = .acceptanceRetry
        }
    }

    func savePassword(router: SessionRouter) async {
        errorKey = nil
        // Границы set-password action (student-portal-auth-actions.ts:107-112).
        if password.count < 12 {
            errorKey = "apply_server_password"
            return
        }
        if password.count > 4096 {
            errorKey = "apply_server_password_too_long"
            return
        }
        if password != confirm {
            errorKey = "apply_invite_password_mismatch"
            return
        }
        let displayName: String?
        if case let .setPassword(name) = phase { displayName = name } else { displayName = nil }
        phase = .saving
        do {
            try await service.updateOwnPassword(password)
        } catch {
            errorKey = "apply_invite_password_rejected"
            phase = .setPassword(displayName: displayName)
            return
        }
        await router.inviteFlowFinished()
    }
}

struct InviteEntryView: View {
    @ObservedObject var router: SessionRouter
    @StateObject private var model = InviteEntryViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    content
                    if let errorKey = model.errorKey {
                        Text(LocalizedStringKey(errorKey))
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
                .padding(20)
            }
            .navigationTitle("apply_invite_title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("cancel_button") {
                        dismiss()
                        Task { await router.inviteFlowFinished() }
                    }
                    .disabled(model.phase == .saving)
                }
            }
        }
        .interactiveDismissDisabled(model.phase == .saving)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .enterToken, .verifying:
            VStack(alignment: .leading, spacing: 12) {
                Text("apply_invite_hint")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                TextField("apply_invite_field_placeholder", text: $model.pasted, axis: .vertical)
                    .lineLimit(2...4)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel(Text("apply_invite_field_label"))
                Button {
                    Task { await model.verify() }
                } label: {
                    Group {
                        if model.phase == .verifying {
                            ProgressView()
                        } else {
                            Text("apply_invite_continue")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .disabled(model.pasted.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                          || model.phase == .verifying)
                .accessibilityLabel(Text("apply_invite_continue"))
            }
        case .acceptanceRetry:
            VStack(alignment: .leading, spacing: 12) {
                Text("apply_invite_accept_retry_hint")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("retry_button") {
                    Task { await model.accept() }
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .accessibilityLabel(Text("retry_button"))
            }
        case let .setPassword(displayName):
            passwordForm(displayName: displayName)
        case .saving:
            passwordForm(displayName: nil)
        }
    }

    @ViewBuilder private func passwordForm(displayName: String?) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let displayName, !displayName.isEmpty {
                Text(String(format: applyString("apply_invite_greeting"), displayName))
                    .font(.headline)
            }
            Text("apply_invite_password_hint")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Group {
                if model.showPassword {
                    TextField("apply_password_label", text: $model.password)
                } else {
                    SecureField("apply_password_label", text: $model.password)
                }
            }
            .textContentType(.newPassword)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textFieldStyle(.roundedBorder)
            .accessibilityLabel(Text("apply_password_label"))
            SecureField("apply_invite_password_confirm", text: $model.confirm)
                .textContentType(.newPassword)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(Text("apply_invite_password_confirm"))
            Button {
                model.showPassword.toggle()
            } label: {
                Text(model.showPassword ? "apply_hide_password" : "apply_show_password")
                    .font(.footnote)
            }
            .accessibilityLabel(Text(model.showPassword ? "apply_hide_password" : "apply_show_password"))
            Button {
                Task { await model.savePassword(router: router) }
            } label: {
                Group {
                    if model.phase == .saving {
                        ProgressView()
                    } else {
                        Text("apply_invite_save_password")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color("AccentColor"))
            .disabled(model.phase == .saving)
            .accessibilityLabel(Text("apply_invite_save_password"))
        }
    }
}
