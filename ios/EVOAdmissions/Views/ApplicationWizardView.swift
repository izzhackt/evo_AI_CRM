import SwiftUI
import Supabase

/// PORT-9a: нативная анкета — те же 9 шагов, тот же порядок валидации и тот
/// же канон значений, что у веб-мастера (ApplicationWizard.tsx). Анонимный
/// режим создаёт аккаунт на последнем шаге через POST /api/portal/registration
/// и ожидает подтверждения почты; signed-in режим (приглашённый, resume, resubmit) отправляет
/// анкету той же RPC, что и веб (submit_student_application_v1).
@MainActor
final class ApplicationWizardViewModel: ObservableObject {
    enum Mode: Equatable {
        case anonymous
        case signedIn(email: String, expectedRevision: Int64)
    }

    @Published var values: ApplicationWizardValues
    @Published var step: ApplicationWizardStep = .countries
    @Published var errorKey: String?
    @Published var conflictHint = false
    @Published var isSubmitting = false
    @Published var fieldSearch = ""
    @Published var customField = ""
    @Published var email = ""
    @Published var password = ""
    @Published var showPassword = false
    @Published var confirmation: StudentSignupPending?
    @Published var confirmationTerminal = false
    @Published var resendNotBefore: Date?

    let mode: Mode
    /// Свежий requestId на сессию мастера — как randomUUID() на рендер
    /// /apply (apply/page.tsx:65); ретраи отправки идемпотентны по нему.
    let requestId = UUID().uuidString.lowercased()

    private let service: SupabaseService
    private let storageKey: String

    init(
        mode: Mode,
        draft: StudentApplicationDraft? = nil,
        namePrefill: SessionRouter.ApplicationNamePrefill? = nil,
        service: SupabaseService = .shared
    ) {
        self.mode = mode
        self.service = service
        // Черновик без пароля, как sessionStorage веба (STORAGE_KEY,
        // ApplicationWizard.tsx:18,84): у signed-in — свой ключ на
        // email+ревизию, у анонима — общий.
        switch mode {
        case .anonymous:
            storageKey = "evo-application-draft-v1"
        case let .signedIn(email, expectedRevision):
            storageKey = "evo-application-draft-v1:\(email):\(expectedRevision)"
        }
        if let draft {
            values = ApplicationWizardValues(draft: draft)
        } else if let restored = Self.restore(key: storageKey) {
            values = restored.values
            step = restored.step
        } else {
            values = ApplicationWizardValues()
            if let namePrefill {
                values.firstName = namePrefill.firstName
                values.lastName = namePrefill.lastName
            }
        }
    }

    var expectedRevision: Int64 {
        if case let .signedIn(_, revision) = mode { return revision }
        return 0
    }

    var signedInEmail: String? {
        if case let .signedIn(email, _) = mode { return email }
        return nil
    }

    // MARK: Draft persistence (no password ever)

    private struct StoredDraft: Codable {
        let values: ApplicationWizardValues
        let step: Int
    }

    private static func restore(key: String) -> (values: ApplicationWizardValues, step: ApplicationWizardStep)? {
        guard let data = UserDefaults.standard.data(forKey: key),
              let stored = try? JSONDecoder().decode(StoredDraft.self, from: data),
              let step = ApplicationWizardStep(rawValue: min(max(stored.step, 0), 8))
        else { return nil }
        return (stored.values, step)
    }

    func persistDraft() {
        let stored = StoredDraft(values: values, step: step.rawValue)
        if let data = try? JSONEncoder().encode(stored) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    func clearDraft() {
        UserDefaults.standard.removeObject(forKey: storageKey)
    }

    // MARK: Step mechanics (web parity)

    func toggle(_ key: WritableKeyPath<ApplicationWizardValues, [String]>, value: String, step: ApplicationWizardStep) {
        var list = values[keyPath: key]
        let limit = ApplicationWizardPolicy.selectionLimit(for: step)
        if !list.contains(value) && list.count >= limit {
            errorKey = "apply_limit_error:\(limit)"
            return
        }
        if let index = list.firstIndex(of: value) {
            list.remove(at: index)
        } else {
            list.append(value)
        }
        values[keyPath: key] = list
        errorKey = nil
        persistDraft()
    }

    func addCustomField() {
        let field = customField.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !field.isEmpty else { return }
        if !values.studyFields.contains(field) {
            toggle(\.studyFields, value: field, step: .fields)
        }
        customField = ""
    }

    func goBack() {
        guard let previous = ApplicationWizardStep(rawValue: step.rawValue - 1) else { return }
        errorKey = nil
        conflictHint = false
        step = previous
        persistDraft()
    }

    /// «Продолжить»: гейт текущего шага (порядок сообщений — ApplicationWizard
    /// .tsx:135-149); на последнем шаге запускает отправку.
    func advance(router: SessionRouter) async {
        conflictHint = false
        if let key = ApplicationWizardPolicy.validationKey(
            step: step, values: values, requestId: requestId
        ) {
            errorKey = key
            return
        }
        if step == .account {
            await submit(router: router)
            return
        }
        errorKey = nil
        step = ApplicationWizardStep(rawValue: step.rawValue + 1) ?? .account
        persistDraft()
    }

    private func submit(router: SessionRouter) async {
        let draft = values.draft(requestId: requestId)
        switch mode {
        case .anonymous:
            await registerAndSignIn(draft: draft, router: router)
        case .signedIn:
            await submitSignedIn(draft: draft, router: router)
        }
    }

    /// Anonymous registration preserves the questionnaire while email confirmation
    /// is pending. Login is a separate explicit action after confirmation.
    private func registerAndSignIn(draft: StudentApplicationDraft, router: SessionRouter) async {
        defer { password = "" }
        let normalizedEmail = email.trimmingCharacters(in: .whitespaces).lowercased()
        guard ApplicationWizardPolicy.isValidEmail(normalizedEmail) else {
            errorKey = "apply_email_invalid"
            return
        }
        if let passwordIssue = ApplicationWizardPolicy.passwordIssueKey(password) {
            errorKey = passwordIssue
            return
        }
        isSubmitting = true
        defer { isSubmitting = false; password = "" }
        do {
            let outcome = try await service.registerStudentAccount(
                draft: draft, email: normalizedEmail, password: password
            )
            if let failure = ApplicationWizardPolicy.registrationErrorKey(outcome) {
                errorKey = failure
                conflictHint = outcome == .conflict
                if outcome == .createUnknown { confirmationTerminal = true }
                return
            }
            if case let .pending(value) = outcome {
                confirmation = value
                resendNotBefore = value.retryAfterSeconds.map { Date().addingTimeInterval(TimeInterval($0)) }
                errorKey = nil
            }

        } catch {
            // A lost registration response may follow a successful Auth creation.
            confirmationTerminal = true
            errorKey = "signup_confirmation_support"
        }
    }

    func resendConfirmation() async {
        guard let current = confirmation, !isSubmitting, !confirmationTerminal else { return }
        guard current.expiresAt > Date() else {
            confirmationTerminal = true
            confirmation = nil
            errorKey = "signup_confirmation_support"
            return
        }
        guard resendNotBefore.map({ $0 <= Date() }) ?? true else { return }
        isSubmitting = true
        defer { isSubmitting = false; password = "" }
        do {
            let outcome = try await service.resendStudentRegistration(capability: current.resendCapability)
            if case let .pending(value) = outcome {
                guard value.resendCapability == current.resendCapability else {
                    errorKey = "apply_server_unavailable"
                    return
                }
                confirmation = value
                resendNotBefore = value.retryAfterSeconds.map { Date().addingTimeInterval(TimeInterval($0)) }
                errorKey = nil
            } else {
                errorKey = ApplicationWizardPolicy.registrationErrorKey(outcome)
                if outcome == .confirmed || outcome == .expired || outcome == .accountConflict {
                    confirmationTerminal = true
                    confirmation = nil
                }
            }
        } catch { errorKey = "apply_server_unavailable" }
    }

    private func submitSignedIn(draft: StudentApplicationDraft, router: SessionRouter) async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let application = try await service.submitStudentApplication(
                draft: draft, expectedRevision: expectedRevision
            )
            clearDraft()
            try? await service.clearStudentApplicationMetadataDraft()
            router.applicationSubmitted(application)
        } catch {
            if let postgrest = error as? PostgrestError,
               ["PT409", "23505", "40001"].contains(postgrest.code ?? "") {
                // Ревизия устарела или заявка уже есть — показываем честное
                // текущее состояние (идемпотентный урок веба).
                await router.refreshApplicationStatus()
                return
            }
            errorKey = "apply_submit_failed"
        }
    }
}

// MARK: - Localization helpers (web `opt.*` / `field.*` dictionaries)

func applyString(_ key: String) -> String {
    Bundle.main.localizedString(forKey: key, value: key, table: nil)
}

/// `opt = (key) => strings["opt." + key] ?? key` (ApplicationWizard.tsx:82).
func applyOptionLabel(_ value: String) -> String {
    Bundle.main.localizedString(forKey: "apply_opt_\(value)", value: value, table: nil)
}

/// `field.*` — подпись направления; канон значения остаётся RU-строкой.
func applyFieldLabel(_ value: String) -> String {
    Bundle.main.localizedString(forKey: "apply_field_\(value)", value: value, table: nil)
}

/// localizedCountryLabel parity (student-application-presentation.ts:29-39):
/// KY из ICU, честный фолбэк на RU-имена.
func applyCountryName(_ code: String) -> String {
    if AppLocale.isKyrgyz,
       let name = Locale(identifier: "ky").localizedString(forRegionCode: code) {
        return name
    }
    return Locale(identifier: "ru").localizedString(forRegionCode: code) ?? code
}

func applyCountryFlag(_ code: String) -> String {
    String(code.unicodeScalars.compactMap { scalar in
        Unicode.Scalar(scalar.value + 127397).map(Character.init)
    })
}

// MARK: - View

struct ApplicationWizardView: View {
    @ObservedObject var router: SessionRouter
    @StateObject private var model: ApplicationWizardViewModel
    private let onSignIn: (() -> Void)?

    init(
        router: SessionRouter,
        mode: ApplicationWizardViewModel.Mode,
        draft: StudentApplicationDraft? = nil,
        namePrefill: SessionRouter.ApplicationNamePrefill? = nil,
        onSignIn: (() -> Void)? = nil
    ) {
        self.router = router
        self.onSignIn = onSignIn
        _model = StateObject(wrappedValue: ApplicationWizardViewModel(
            mode: mode, draft: draft, namePrefill: namePrefill
        ))
    }

    private var errorText: String? {
        guard let key = model.errorKey else { return nil }
        // apply_limit_error carries its limit (web formatPortalString).
        if key.hasPrefix("apply_limit_error:"), let limit = key.split(separator: ":").last {
            return String(format: applyString("apply_limit_error"), String(limit))
        }
        return applyString(key)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if model.confirmation != nil || model.confirmationTerminal {
                    confirmationContent
                } else {
                    header
                    stepContent
                }
                if let errorText {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(errorText)
                            .font(.footnote)
                            .foregroundStyle(.red)
                        if model.conflictHint {
                            Button("apply_go_to_login") {
                                Task { await router.signOut() }
                            }
                            .font(.footnote)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
                if model.confirmation == nil && !model.confirmationTerminal { footer }
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: model.values) { model.persistDraft() }
    }

    private var confirmationContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("signup_confirmation_title").font(.title2.bold())
            if let pending = model.confirmation {
                Text(pending.maskedEmail).font(.body).textSelection(.enabled)
                Text(applyString(pending.dispatch == "accepted" ? "signup_confirmation_check_email" : "signup_confirmation_send_uncertain"))
                    .foregroundStyle(.secondary)
                Text("signup_confirmation_latest").font(.footnote).foregroundStyle(.secondary)
                if !model.confirmationTerminal {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Button("signup_confirmation_resend") { Task { await model.resendConfirmation() } }
                            .frame(minHeight: 44)
                            .disabled(model.isSubmitting || (model.resendNotBefore.map { $0 > context.date } ?? false))
                    }
                }
            }
            Button("signup_confirmation_sign_in") {
                if let onSignIn {
                    onSignIn()
                } else {
                    Task { await router.signOut() }
                }
            }
                .frame(minHeight: 44).disabled(model.isSubmitting)
            Text("signup_confirmation_sign_in_hint").font(.footnote).foregroundStyle(.secondary)
            Link("evo@evoadmissions.com", destination: URL(string: "mailto:evo@evoadmissions.com")!)
                .frame(minHeight: 44)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(applyString("apply_step_\(stepKey(model.step))"))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(String(format: applyString("apply_step_of"), model.step.rawValue + 1))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: Double(model.step.rawValue + 1), total: 9)
                .tint(Color("AccentColor"))
                .accessibilityLabel(Text("apply_progress_label"))
                .accessibilityValue(Text(String(format: applyString("apply_step_of"), model.step.rawValue + 1)))
            Text(model.step == .account && model.signedInEmail != nil
                ? applyString("apply_contacts_heading")
                : applyString("apply_question_\(stepKey(model.step))"))
                .font(.title2.bold())
            if let copy = stepCopy {
                Text(copy)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var stepCopy: String? {
        switch model.step {
        case .countries, .fields, .levels: return applyString("apply_copy_multi")
        case .budget: return applyString("apply_copy_budget")
        case .account: return applyString("apply_copy_account")
        default: return nil
        }
    }

    private func stepKey(_ step: ApplicationWizardStep) -> String {
        switch step {
        case .countries: return "countries"
        case .intake: return "intake"
        case .education: return "education"
        case .fields: return "fields"
        case .levels: return "levels"
        case .nationality: return "nationality"
        case .english: return "english"
        case .budget: return "budget"
        case .account: return "account"
        }
    }

    @ViewBuilder private var stepContent: some View {
        switch model.step {
        case .countries: countriesStep
        case .intake: intakeStep
        case .education: educationStep
        case .fields: fieldsStep
        case .levels: levelsStep
        case .nationality: nationalityStep
        case .english: englishStep
        case .budget: budgetStep
        case .account: accountStep
        }
    }

    private func choiceRow(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(label)
                    .multilineTextAlignment(.leading)
                Spacer()
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selected ? Color("AccentColor") : Color.secondary)
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(selected ? Color("AccentColor").opacity(0.12) : Color(.secondarySystemBackground))
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    private var countriesStep: some View {
        VStack(spacing: 10) {
            ForEach(ApplicationContract.destinationCountries, id: \.self) { country in
                choiceRow(
                    "\(applyCountryFlag(country)) \(applyOptionLabel(country))",
                    selected: model.values.destinationCountries.contains(country)
                ) {
                    model.toggle(\.destinationCountries, value: country, step: .countries)
                }
            }
        }
    }

    private var intakeStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            pickerRow("apply_intake_label", selection: $model.values.intakeSeason,
                      options: ApplicationContract.intakeSeasons.map { ($0, applyOptionLabel($0)) },
                      placeholderKey: "apply_choose_placeholder")
            let year = Calendar(identifier: .gregorian).component(.year, from: Date())
            pickerRow("apply_year_label", selection: $model.values.intakeYear,
                      options: (year...year + 6).map { (String($0), String($0)) },
                      placeholderKey: "apply_choose_year")
        }
    }

    private var educationStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            pickerRow("apply_education_label", selection: $model.values.educationLevel,
                      options: ApplicationContract.educationLevels.map { ($0, applyOptionLabel($0)) },
                      placeholderKey: "apply_choose_placeholder")
            VStack(alignment: .leading, spacing: 6) {
                Text("apply_grade_label")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                TextField("apply_grade_label", text: $model.values.averageGrade)
                    .keyboardType(.decimalPad)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel(Text("apply_grade_label"))
            }
            pickerRow("apply_grade_scale_label", selection: $model.values.gradeScale,
                      options: ApplicationContract.gradeScales.map {
                          ($0, String(format: applyString("apply_grade_scale_of"), $0))
                      },
                      placeholderKey: nil)
        }
    }

    private var fieldsStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("apply_field_search_placeholder", text: $model.fieldSearch)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel(Text("apply_field_search_label"))
            let query = model.fieldSearch.lowercased()
            let options = ApplicationContract.studyFieldOptions.filter {
                query.isEmpty
                    || $0.lowercased().contains(query)
                    || applyFieldLabel($0).lowercased().contains(query)
            }
            ForEach(options, id: \.self) { field in
                choiceRow(applyFieldLabel(field), selected: model.values.studyFields.contains(field)) {
                    model.toggle(\.studyFields, value: field, step: .fields)
                }
            }
            let custom = model.values.studyFields.filter { !ApplicationContract.studyFieldOptions.contains($0) }
            ForEach(custom, id: \.self) { field in
                choiceRow(field, selected: true) {
                    model.toggle(\.studyFields, value: field, step: .fields)
                }
                .accessibilityHint(Text(String(format: applyString("apply_remove_field"), field)))
            }
            HStack(alignment: .bottom, spacing: 10) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("apply_custom_field_label")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    TextField("apply_custom_field_label", text: $model.customField)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: model.customField) {
                            if model.customField.count > 100 {
                                model.customField = String(model.customField.prefix(100))
                            }
                        }
                        .accessibilityLabel(Text("apply_custom_field_label"))
                }
                Button("apply_add_field") { model.addCustomField() }
                    .buttonStyle(.bordered)
                    .disabled(model.customField.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private var levelsStep: some View {
        VStack(spacing: 10) {
            ForEach(ApplicationContract.studyLevels, id: \.self) { level in
                choiceRow(applyOptionLabel(level), selected: model.values.studyLevels.contains(level)) {
                    model.toggle(\.studyLevels, value: level, step: .levels)
                }
            }
        }
    }

    private var nationalityStep: some View {
        let countries = ApplicationContract.nationalities
            .map { (code: $0, name: applyCountryName($0)) }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        return pickerRow(
            "apply_nationality_label",
            selection: $model.values.nationality,
            options: countries.map { ($0.code, $0.name) },
            placeholderKey: "apply_choose_country"
        )
    }

    private var englishStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("apply_english_legend")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            choiceRow(applyString("apply_english_yes"), selected: model.values.englishMode == "exam") {
                model.values.englishMode = "exam"
                model.errorKey = nil
            }
            choiceRow(applyString("apply_english_no"), selected: model.values.englishMode == "self") {
                model.values.englishMode = "self"
                model.errorKey = nil
            }
            if model.values.englishMode == "exam" {
                pickerRow("apply_exam_label", selection: $model.values.englishExam,
                          options: ApplicationContract.englishExams.map { ($0.key, applyOptionLabel($0.key)) },
                          placeholderKey: nil)
                VStack(alignment: .leading, spacing: 6) {
                    Text("apply_exam_score_label")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    TextField("apply_exam_score_label", text: $model.values.englishScore)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel(Text("apply_exam_score_label"))
                }
            }
            if model.values.englishMode == "self" {
                pickerRow("apply_self_level_label", selection: $model.values.englishLevel,
                          options: ApplicationContract.englishLevels.map { ($0, applyOptionLabel($0)) },
                          placeholderKey: "apply_choose_placeholder")
            }
        }
    }

    private var budgetStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            pickerRow("apply_budget_label", selection: $model.values.tuitionBudget,
                      options: ApplicationContract.tuitionBudgets.map { ($0, applyOptionLabel($0)) },
                      placeholderKey: "apply_choose_placeholder")
            pickerRow("apply_funding_label", selection: $model.values.fundingSource,
                      options: ApplicationContract.fundingSources.map { ($0, applyOptionLabel($0)) },
                      placeholderKey: "apply_choose_placeholder")
        }
    }

    private var accountStep: some View {
        VStack(alignment: .leading, spacing: 14) {
            labeledField("apply_first_name_label", text: $model.values.firstName,
                         contentType: .givenName, limit: 60)
            labeledField("apply_last_name_label", text: $model.values.lastName,
                         contentType: .familyName, limit: 60)
            VStack(alignment: .leading, spacing: 6) {
                Text("apply_phone_label")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                TextField(applyString("apply_phone_placeholder"), text: $model.values.phone)
                    .keyboardType(.phonePad)
                    .textContentType(.telephoneNumber)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: model.values.phone) {
                        if model.values.phone.count > 40 {
                            model.values.phone = String(model.values.phone.prefix(40))
                        }
                    }
                    .accessibilityLabel(Text("apply_phone_label"))
            }
            if let signedInEmail = model.signedInEmail {
                VStack(alignment: .leading, spacing: 6) {
                    Text("apply_account_email_label")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    Text(signedInEmail)
                }
                .accessibilityElement(children: .combine)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("apply_email_label")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    TextField("apply_email_label", text: $model.email)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel(Text("apply_email_label"))
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("apply_password_label")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    HStack(spacing: 8) {
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
                        Button {
                            model.showPassword.toggle()
                        } label: {
                            Text(model.showPassword ? "apply_hide_password" : "apply_show_password")
                                .font(.footnote)
                        }
                        .accessibilityLabel(Text(model.showPassword ? "apply_hide_password" : "apply_show_password"))
                    }
                    Text("apply_password_hint")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            Toggle(isOn: $model.values.consent) {
                Text("apply_consent_label")
                    .font(.subheadline)
            }
            .tint(Color("AccentColor"))
            .accessibilityLabel(Text("apply_consent_label"))
        }
    }

    private func labeledField(
        _ titleKey: String,
        text: Binding<String>,
        contentType: UITextContentType,
        limit: Int
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(LocalizedStringKey(titleKey))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            TextField(LocalizedStringKey(titleKey), text: text)
                .textContentType(contentType)
                .textFieldStyle(.roundedBorder)
                .onChange(of: text.wrappedValue) {
                    if text.wrappedValue.count > limit {
                        text.wrappedValue = String(text.wrappedValue.prefix(limit))
                    }
                }
                .accessibilityLabel(Text(LocalizedStringKey(titleKey)))
        }
    }

    private func pickerRow(
        _ titleKey: String,
        selection: Binding<String>,
        options: [(String, String)],
        placeholderKey: String?
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(LocalizedStringKey(titleKey))
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            Picker(selection: selection) {
                if let placeholderKey {
                    Text(LocalizedStringKey(placeholderKey)).tag("")
                }
                ForEach(options, id: \.0) { option in
                    Text(option.1).tag(option.0)
                }
            } label: {
                Text(LocalizedStringKey(titleKey))
            }
            .pickerStyle(.menu)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
            .accessibilityLabel(Text(LocalizedStringKey(titleKey)))
        }
    }

    private var footer: some View {
        HStack {
            if model.step != .countries {
                Button("apply_back") { model.goBack() }
                    .disabled(model.isSubmitting)
                    .accessibilityLabel(Text("apply_back"))
            }
            Spacer()
            Button {
                Task { await model.advance(router: router) }
            } label: {
                Group {
                    if model.isSubmitting {
                        ProgressView()
                    } else if model.step == .account {
                        Text(model.signedInEmail != nil ? "apply_submit_application" : "apply_create_account")
                    } else {
                        Text("apply_continue")
                    }
                }
                .frame(minWidth: 140)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color("AccentColor"))
            .disabled(model.isSubmitting)
        }
        .padding(.top, 8)
    }
}
