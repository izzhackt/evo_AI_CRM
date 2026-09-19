import SwiftUI

struct SignInView: View {
    @ObservedObject var router: SessionRouter
    @State private var email = ""
    @State private var password = ""
    @State private var showApplicationWizard = false
    @State private var showInviteEntry = false

    private var isAuthenticating: Bool {
        if case .authenticating = router.state { return true }
        return false
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("evo_admissions_app_name")
                    .font(.largeTitle.bold())

                Text("sign_in_title")
                    .font(.title3)
                    .foregroundStyle(.secondary)

                VStack(alignment: .leading, spacing: 12) {
                    TextField("sign_in_email_placeholder", text: $email)
                        .textContentType(.username)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))

                    SecureField("sign_in_password_placeholder", text: $password)
                        .textContentType(.password)
                        .padding(12)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10))
                }

                if let signInError = router.signInError {
                    Text(signInError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }

                Button {
                    Task { await router.signIn(email: email, password: password) }
                } label: {
                    Group {
                        if isAuthenticating {
                            ProgressView()
                        } else {
                            Text("sign_in_button")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .disabled(email.isEmpty || password.isEmpty || isAuthenticating)

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
                    .buttonStyle(.bordered)
                    .tint(Color("AccentColor"))
                    .disabled(isAuthenticating)
                    .accessibilityLabel(Text("apply_entry_button"))

                    Button {
                        router.inviteFlowActive = true
                        showInviteEntry = true
                    } label: {
                        Text("apply_invite_entry_button")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .disabled(isAuthenticating)
                    .accessibilityLabel(Text("apply_invite_entry_button"))
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .fullScreenCover(isPresented: $showApplicationWizard) {
            NavigationStack {
                ApplicationWizardView(router: router, mode: .anonymous)
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
    }
}
