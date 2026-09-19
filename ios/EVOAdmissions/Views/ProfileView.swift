import SwiftUI

/// Профиль: имя, email, честная строка состояния доступа, версия приложения
/// и выход. Структура секций рассчитана на расширение (язык интерфейса и
/// инициирование удаления аккаунта появятся, когда их серверный контракт
/// будет в production, — не раньше).
struct ProfileView: View {
    let session: SessionRouter.PortalSession
    @ObservedObject var router: SessionRouter

    @State private var email: String?
    @State private var isSigningOut = false

    private var accessStatusKey: LocalizedStringKey {
        switch session.portalCase.caseState {
        case "pending": return "case_status_pending"
        case "active": return "case_status_active"
        case "closed": return "case_status_closed"
        default: return "case_status_unknown"
        }
    }

    private var appVersion: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        switch (version, build) {
        case let (version?, build?): return "\(version) (\(build))"
        case let (version?, nil): return version
        default: return "—"
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LabeledContent {
                        Text(session.authority.displayName)
                    } label: {
                        Text("profile_name_label")
                    }
                    LabeledContent {
                        Text(email ?? "—")
                    } label: {
                        Text("profile_email_label")
                    }
                    LabeledContent {
                        Text(accessStatusKey)
                    } label: {
                        Text("profile_access_label")
                    }
                }

                Section {
                    LabeledContent {
                        Text(appVersion)
                    } label: {
                        Text("profile_app_version")
                    }
                }

                Section {
                    Button(role: .destructive) {
                        Task {
                            isSigningOut = true
                            await router.signOut()
                            isSigningOut = false
                        }
                    } label: {
                        if isSigningOut {
                            ProgressView()
                        } else {
                            Text("sign_out_button")
                        }
                    }
                    .disabled(isSigningOut)
                }
            }
            .navigationTitle("tab_profile")
            .task {
                // Email берём из реальной Auth-сессии, не из кэша профиля.
                email = try? await SupabaseService.shared.client.auth.session.user.email
            }
        }
    }
}
