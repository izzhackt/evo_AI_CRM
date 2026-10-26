import SwiftUI

/// Профиль (миграции 196/197/280): данные аккаунта, язык портала RU/KY,
/// личные результаты тестов, консультация с историей своих запросов,
/// выход и удаление аккаунта (App Store §5.1.1(v)).
///
/// Честные состояния: язык считается сохранённым только после receipt
/// сервера; статус запроса на удаление приходит с сервера
/// (`own_account_deletion_request_v1`, 280), а не из локального флага.
@MainActor
final class ProfileViewModel: ObservableObject {
    enum LanguageState: Equatable {
        case idle
        case saving
        case saved
        case failed
    }

    @Published var profile: PortalProfile?
    @Published var profileLoadFailed = false
    @Published var isLoadingProfile = false

    @Published var selectedLanguage = "ru"
    @Published var languageState: LanguageState = .idle
    /// Baseline for the save-button visibility check: the LAST-SAVED language
    /// (server receipt), not the value loaded at app launch — updated on
    /// every successful `saveLanguage()` so switching back after a save
    /// doesn't require a relaunch.
    @Published var lastSavedLanguage = "ru"

    @Published var consultationHistory: [ConsultationReceipt] = []
    @Published var historyLoadFailed = false

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func load() async {
        if isLoadingProfile { return }
        isLoadingProfile = true
        profileLoadFailed = false
        do {
            let profile = try await service.getOwnPortalProfile()
            self.profile = profile
            selectedLanguage = profile.portalLanguage
            lastSavedLanguage = profile.portalLanguage
        } catch {
            profileLoadFailed = true
        }
        isLoadingProfile = false
        await loadHistory()
    }

    func loadHistory() async {
        historyLoadFailed = false
        do {
            consultationHistory = try await service.ownConsultationRequests()
        } catch {
            historyLoadFailed = true
        }
    }

    /// Язык: сначала подтверждение сервером (receipt), только затем локальная
    /// смена языка приложения. Полное применение — после перезапуска
    /// (AppleLanguages-override), о чём экран говорит честно.
    func saveLanguage() async {
        guard languageState != .saving,
              selectedLanguage == "ru" || selectedLanguage == "ky" else { return }
        languageState = .saving
        do {
            let receipt = try await service.setOwnPortalLanguage(selectedLanguage)
            UserDefaults.standard.set([receipt.portalLanguage], forKey: "AppleLanguages")
            lastSavedLanguage = receipt.portalLanguage
            languageState = .saved
        } catch {
            languageState = .failed
        }
    }
}

struct ProfileView: View {
    let session: SessionRouter.PortalSession
    @ObservedObject var router: SessionRouter
    @ObservedObject var aiConsent: AIConsentModel

    @StateObject private var model = ProfileViewModel()
    @State private var sessionEmail: String?
    @State private var isSigningOut = false
    @State private var showsConsultationSheet = false
    @StateObject private var deletion = AccountDeletionModel()

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
                dataSection
                testsSection
                languageSection
                AIConsentSettingsSection(model: aiConsent, tier: session.accessTier)
                consultationSection
                appSection
                sessionSection
                AccountDeletionContent(model: deletion)
            }
            .navigationTitle("tab_profile")
            .task(id: session.accessTier) {
                // Email берём из реальной Auth-сессии как фолбэк; профиль
                // (196) даёт серверную копию вместе с языком и отметкой
                // запроса удаления.
                sessionEmail = try? await SupabaseService.shared.client.auth.session.user.email
                await model.load()
                await deletion.load()
                await aiConsent.load(offeredTo: session.accessTier)
            }
            .refreshable {
                await model.load()
                await deletion.load()
                await aiConsent.load(offeredTo: session.accessTier)
            }
            .sheet(isPresented: $showsConsultationSheet, onDismiss: {
                Task { await model.loadHistory() }
            }) {
                ConsultationRequestSheet(institutionId: nil, institutionName: nil)
            }
        }
    }

    private var dataSection: some View {
        Section {
            LabeledContent {
                Text(model.profile?.displayName ?? session.authority.displayName)
                    .foregroundStyle(.secondaryText)
            } label: {
                Text("profile_name_label")
            }
            LabeledContent {
                Text(model.profile?.email ?? sessionEmail ?? "—")
                    .foregroundStyle(.secondaryText)
            } label: {
                Text("profile_email_label")
            }
            LabeledContent {
                Text(accessStatusKey)
                    .foregroundStyle(.secondaryText)
            } label: {
                Text("profile_access_label")
            }
        } footer: {
            Group {
                if model.profileLoadFailed {
                    Text("profile_unavailable")
                }
            }
            .foregroundStyle(.secondaryText)
        }
    }

    /// Личные результаты тестов - переход, а не данные аккаунта, поэтому
    /// отдельной строкой, а не внутри карточки с именем и почтой.
    private var testsSection: some View {
        Section {
            NavigationLink {
                TestsContentView()
            } label: {
                Text("profile_tests_link")
            }
        }
    }

    private var languageSection: some View {
        Section {
            Picker("profile_language_heading", selection: $model.selectedLanguage) {
                Text("profile_language_ru").tag("ru")
                Text("profile_language_ky").tag("ky")
            }
            .pickerStyle(.menu)
            .disabled(model.profile == nil)

            if ProfileLanguagePolicy.showsSaveButton(
                hasProfile: model.profile != nil,
                selectedLanguage: model.selectedLanguage,
                lastSavedLanguage: model.lastSavedLanguage,
                isSaving: model.languageState == .saving
            ) {
                Button {
                    Task { await model.saveLanguage() }
                } label: {
                    if model.languageState == .saving {
                        ProgressView()
                    } else {
                        Text("profile_language_save")
                    }
                }
                .disabled(model.languageState == .saving)
                // A11y (9b): во время сохранения label — ProgressView.
                .accessibilityLabel(Text("profile_language_save"))
            }

            switch model.languageState {
            case .saved:
                Text("profile_language_saved_restart")
                    .font(.footnote)
                    .foregroundStyle(.secondaryText)
            case .failed:
                Text("profile_language_error")
                    .font(.footnote)
                    .foregroundStyle(.dangerText)
            case .idle, .saving:
                EmptyView()
            }
        } footer: {
            // Заголовок секции совпадал с подписью строки («Язык портала»
            // дважды подряд), поэтому остаётся только подпись у выбора.
            Text("profile_language_hint")
                .foregroundStyle(.secondaryText)
        }
    }

    private var consultationSection: some View {
        Section {
            Button {
                showsConsultationSheet = true
            } label: {
                Label("consultation_cta", systemImage: "bubble.left.and.bubble.right")
            }

            if model.historyLoadFailed {
                Text("consultation_history_unavailable")
                    .font(.footnote)
                    .foregroundStyle(.secondaryText)
            } else {
                ForEach(model.consultationHistory) { receipt in
                    ConsultationHistoryRow(receipt: receipt)
                }
            }
        } header: {
            Text("consultation_heading")
                .foregroundStyle(.secondaryText)
        } footer: {
            Group {
                if !model.consultationHistory.isEmpty {
                    Text("consultation_history_heading_note")
                }
            }
            .foregroundStyle(.secondaryText)
        }
    }

    /// Политика конфиденциальности (правило App Store 5.1.1(i): ссылка и в
    /// приложении) и уведомления лицензий рядом с версией (review #1215).
    private var appSection: some View {
        Section {
            PrivacyPolicyLink()
            NavigationLink {
                LicensesView()
            } label: {
                Text("licenses_title")
            }
            LabeledContent {
                Text(appVersion)
                    .foregroundStyle(.secondaryText)
            } label: {
                Text("profile_app_version")
            }
        }
    }

    // Выход ничего не удаляет, поэтому кнопка без роли .destructive (аудит
    // UX/UI 2026-10) и нейтрального цвета: брендовый красный читался так же,
    // как «Удалить аккаунт» ниже.
    private var sessionSection: some View {
        Section {
            Button {
                Task {
                    isSigningOut = true
                    // Личные данные (избранное) не переживают выход.
                    FavoritesStore.shared.clear()
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
            .foregroundStyle(.primary)
            .disabled(isSigningOut)
            // A11y (9b): во время выхода label — ProgressView.
            .accessibilityLabel(Text("sign_out_button"))
        }
    }
}

private struct ConsultationHistoryRow: View {
    let receipt: ConsultationReceipt

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(receipt.isOpen ? "consultation_status_requested" : "consultation_status_handled")
                .font(.subheadline.weight(.medium))
            if let name = receipt.institutionName {
                Text(String(
                    format: String(localized: "consultation_university_line"),
                    name
                ))
                .font(.footnote)
                .foregroundStyle(.secondaryText)
            }
            if let note = receipt.note, !note.isEmpty {
                Text(note)
                    .font(.footnote)
                    .foregroundStyle(.secondaryText)
                    .lineLimit(2)
            }
            if let date = PostgresTimestamp.dayLabel(
                from: receipt.requestedAt,
                locale: AppLocale.current
            ) {
                Text(String(
                    format: String(localized: "consultation_history_date"),
                    date
                ))
                .font(.caption)
                .foregroundStyle(.secondaryText)
            }
            if let handledAt = receipt.handledAt,
               let date = PostgresTimestamp.dayLabel(from: handledAt, locale: AppLocale.current) {
                Text(String(
                    format: String(localized: "consultation_handled_date"),
                    date
                ))
                .font(.caption)
                .foregroundStyle(.secondaryText)
            }
        }
        .padding(.vertical, 2)
        // A11y (9b): строка истории — один элемент VoiceOver, а не четыре.
        .accessibilityElement(children: .combine)
    }
}
