import SwiftUI

struct SignInView: View {
    @ObservedObject var router: SessionRouter
    @State private var email = ""
    @State private var password = ""
    @State private var showApplicationWizard = false
    @State private var showInviteEntry = false
    @State private var showPasswordReset = false
    @FocusState private var focusedField: AuthField.Kind?

    private var isAuthenticating: Bool {
        if case .authenticating = router.state { return true }
        return false
    }

    private var canSubmit: Bool {
        !email.isEmpty && !password.isEmpty && !isAuthenticating
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("evo_admissions_app_name")
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)
                    .motionStagger(index: 0, key: "signin.title")

                Text("sign_in_title")
                    .font(.title3)
                    .foregroundStyle(.secondaryText)
                    .motionStagger(index: 1, key: "signin.subtitle")

                // Видимые подписи над полями и касание по всей плашке поля
                // (аудит UX/UI 2026-10: подпись была только placeholder 1,70:1,
                // а фокус ловила полоса 22 pt из 46 pt).
                VStack(alignment: .leading, spacing: 14) {
                    AuthField(kind: .email, label: "sign_in_email_placeholder", text: $email, focus: $focusedField)
                        .submitLabel(.next)
                        .onSubmit { focusedField = .password }

                    VStack(alignment: .trailing, spacing: 0) {
                        AuthField(kind: .password, label: "sign_in_password_placeholder", text: $password, focus: $focusedField)
                            .submitLabel(.go)
                            .onSubmit(signIn)

                        Button("sign_in_forgot_password") { showPasswordReset = true }
                            .buttonStyle(.borderless)
                            .font(.subheadline)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                            .disabled(isAuthenticating)
                    }
                }
                .motionStagger(index: 2, key: "signin.form")

                if let errorKey = router.signInErrorKey {
                    Label {
                        Text(LocalizedStringKey(errorKey))
                            .foregroundStyle(.primary)
                    } icon: {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(.dangerText)
                    }
                    .font(.subheadline)
                }

                Button(action: signIn) {
                    Group {
                        if isAuthenticating {
                            ProgressView()
                        } else {
                            Text("sign_in_button")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .accentProminent()
                .controlSize(.large)
                .disabled(!canSubmit)
                // A11y (9b): во время входа label кнопки — ProgressView без
                // текста; VoiceOver должен по-прежнему слышать «Войти».
                .accessibilityLabel(Text("sign_in_button"))
                .motionStagger(index: 3, key: "signin.button")

                // PORT-9a (план §4 «Не зарегистрирован»): анкета и приём
                // приглашения доступны рядом со входом.
                VStack(alignment: .leading, spacing: 12) {
                    Divider()
                    Button {
                        showApplicationWizard = true
                    } label: {
                        Text("apply_entry_button")
                            .frame(maxWidth: .infinity)
                    }
                    .accentBordered()
                    .controlSize(.large)
                    .disabled(isAuthenticating)
                    .accessibilityLabel(Text("apply_entry_button"))

                    Button {
                        router.inviteFlowActive = true
                        showInviteEntry = true
                    } label: {
                        Text("apply_invite_entry_button")
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.borderless)
                    .disabled(isAuthenticating)
                    .accessibilityLabel(Text("apply_invite_entry_button"))
                }
                .motionStagger(index: 4, key: "signin.secondary")
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: router.signInErrorKey) { _, key in
            // Ошибка входа озвучивается VoiceOver, а не только меняет экран.
            guard let key else { return }
            AccessibilityNotification.Announcement(applyString(key)).post()
        }
        .fullScreenCover(isPresented: $showApplicationWizard) {
            NavigationStack {
                ApplicationWizardView(router: router, mode: .anonymous, onSignIn: {
                    showApplicationWizard = false
                })
                    .navigationTitle("apply_wizard_title")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("close_button") { showApplicationWizard = false }
                        }
                    }
            }
        }
        .sheet(isPresented: $showInviteEntry) {
            InviteEntryView(router: router)
        }
        .sheet(isPresented: $showPasswordReset) {
            PasswordResetRequestView(router: router, initialEmail: email)
        }
    }

    private func signIn() {
        guard canSubmit else { return }
        focusedField = nil
        Task { await router.signIn(email: email, password: password) }
    }
}

/// Поле входа с видимой подписью. Плашка целиком принимает касание и
/// переводит фокус в поле; граница `systemGray` даёт не меньше 3:1 к фону.
struct AuthField: View {
    enum Kind: Hashable { case email, password }

    let kind: Kind
    let label: LocalizedStringKey
    @Binding var text: String
    var focus: FocusState<Kind?>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
                .accessibilityHidden(true)
            field
                .focused(focus, equals: kind)
                .font(.body)
                .accessibilityLabel(Text(label))
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .background {
                    // Касание по свободной части плашки ставит фокус в поле;
                    // касания по самому тексту обрабатывает поле.
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color(.systemBackground))
                        .contentShape(RoundedRectangle(cornerRadius: 10))
                        .onTapGesture { focus.wrappedValue = kind }
                        .accessibilityHidden(true)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 10)
                        .strokeBorder(focus.wrappedValue == kind ? Color.accentColor : Color(.systemGray),
                                      lineWidth: focus.wrappedValue == kind ? 2 : 1)
                        .allowsHitTesting(false)
                }
        }
    }

    @ViewBuilder private var field: some View {
        switch kind {
        case .email:
            TextField("", text: $text)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        case .password:
            SecureField("", text: $text)
                .textContentType(.password)
        }
    }
}

/// «Забыли пароль?» (общий контракт веба и iPhone): письмо со ссылкой на
/// веб-кабинет студента, где задаётся новый пароль. Ответ одинаковый для
/// любого адреса; отдельно только лимиты, не связанные с адресом, и сбой
/// связи. После ответа «отправлено» кнопка выключена на 60 с, как в вебе.
struct PasswordResetRequestView: View {
    @ObservedObject var router: SessionRouter
    @State private var email: String
    @State private var sending = false
    @State private var outcome: AuthMessagePolicy.RecoveryOutcome?
    @State private var resendAt: Date?
    @FocusState private var focusedField: AuthField.Kind?
    @Environment(\.dismiss) private var dismiss

    init(router: SessionRouter, initialEmail: String) {
        self.router = router
        _email = State(initialValue: AuthMessagePolicy.normalizedEmail(initialEmail))
    }

    private func secondsUntilResend(at now: Date) -> Int {
        guard let resendAt else { return 0 }
        return max(0, Int(resendAt.timeIntervalSince(now).rounded(.up)))
    }

    private func canSend(at now: Date) -> Bool {
        !sending && secondsUntilResend(at: now) == 0 && AuthMessagePolicy.looksLikeEmail(email)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("forgot_password_lead")
                        .font(.body)
                        .foregroundStyle(.primary)

                    AuthField(kind: .email, label: "sign_in_email_placeholder", text: $email, focus: $focusedField)
                        .submitLabel(.send)
                        .onSubmit(send)
                        .onChange(of: email) { outcome = nil }

                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let wait = secondsUntilResend(at: context.date)
                        VStack(alignment: .leading, spacing: 8) {
                            Button(action: send) {
                                HStack(spacing: 8) {
                                    if sending { ProgressView() }
                                    Text("forgot_password_send")
                                }
                                .frame(maxWidth: .infinity)
                            }
                            .accentProminent()
                            .controlSize(.large)
                            .disabled(!canSend(at: context.date))
                            .accessibilityLabel(Text("forgot_password_send"))

                            if wait > 0 {
                                Text(String(format: String(localized: "forgot_password_resend_in"), wait))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondaryText)
                            }
                        }
                    }

                    if let outcome {
                        result(outcome)
                    }
                }
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("forgot_password_title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("close_button") { dismiss() }
                }
            }
            .onAppear { if email.isEmpty { focusedField = .email } }
        }
        .interactiveDismissDisabled(sending)
    }

    @ViewBuilder private func result(_ outcome: AuthMessagePolicy.RecoveryOutcome) -> some View {
        let key = LocalizedStringKey(AuthMessagePolicy.recoveryMessageKey(outcome))
        if outcome == .sent {
            VStack(alignment: .leading, spacing: 8) {
                Label {
                    Text(key)
                } icon: {
                    Image(systemName: "envelope.badge")
                        .foregroundStyle(Color.accentColor)
                }
                Text("forgot_password_next_step")
                    .font(.subheadline)
                    .foregroundStyle(.secondaryText)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        } else {
            Label {
                Text(key)
            } icon: {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundStyle(.dangerText)
            }
            .font(.subheadline)
        }
    }

    private func send() {
        guard canSend(at: .now) else { return }
        focusedField = nil
        sending = true
        outcome = nil
        Task {
            let result = await router.requestPasswordReset(email: email)
            sending = false
            outcome = result
            if result == .sent {
                resendAt = Date.now.addingTimeInterval(TimeInterval(AuthMessagePolicy.recoveryResendSeconds))
            }
            AccessibilityNotification.Announcement(
                applyString(AuthMessagePolicy.recoveryMessageKey(result))
            ).post()
        }
    }
}
