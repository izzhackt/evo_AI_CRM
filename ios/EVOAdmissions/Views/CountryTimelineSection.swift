import Supabase
import SwiftUI

// «Путь поступления» на «Главной» (S4, план §8.4; контракт
// docs/portal/country-timeline-contract.md §3, §4 и §5). Одни данные и правила с
// вебом: выбор из RPC 284, таймлайн из файлов bundle (CountryTimeline.swift).
// Шаг открывается листом с пунктами; три оговорки под таймлайном всегда.

/// Чтение выбора страны и сохранение нового выбора. Отдельно от других
/// блоков «Главной»: сбой здесь не прячет уроки и избранное.
@MainActor
final class CountryTimelineModel: ObservableObject {
    enum Read: Equatable {
        case loading
        /// Первое чтение не удалось (сеть, отказ RPC или ответ не той формы):
        /// карточка выбора и честная плашка, как у веба (`readError`).
        case failed
        case loaded(StudentCountryChoice)
    }

    @Published private(set) var read: Read = .loading
    @Published private(set) var library: CountryTimelineLibrary?
    /// Страна, выбор которой сейчас сохраняется.
    @Published private(set) var savingCountry: String?
    @Published private(set) var saveFailed = false
    /// Неудачная попытка: тот же выбор повторяется с тем же request id.
    private var failedAttempt: CountryChoiceAttempt?
    private var loading = false

    func load() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        if library == nil {
            // Разбор семи файлов (≈260 КБ) один раз и не на главном потоке.
            library = await Task.detached(priority: .userInitiated) { CountryTimelineLibrary.bundled }.value
        }
        do {
            read = .loaded(try await SupabaseService.shared.studentCountryChoice())
        } catch {
            guard !Task.isCancelled else { return }
            // Неудачное фоновое обновление (возврат в приложение, обновление
            // потягиванием) не прячет уже показанный путь.
            if case .loaded = read { return }
            read = .failed
        }
    }

    /// Сохраняет выбор; true, если сервер его принял. Затем перечитывает
    /// выбор, как веб (контракт §5, п. 4).
    @discardableResult
    func choose(_ country: String) async -> Bool {
        guard savingCountry == nil else { return false }
        let attempt = CountryChoiceAttempt.next(for: country, after: failedAttempt)
        savingCountry = country
        saveFailed = false
        // VoiceOver слышит то же, что веб отдаёт через role="status" и role="alert".
        Self.announce(String(localized: "home_timeline_saving"))
        defer { savingCountry = nil }
        do {
            let receipt = try await SupabaseService.shared.setStudentCountryChoice(attempt)
            failedAttempt = nil
            read = .loaded(receipt)
            if let fresh = try? await SupabaseService.shared.studentCountryChoice() { read = .loaded(fresh) }
            // Как фокус на заголовке у веба: читалка называет новую страну.
            Self.announce(Self.heading(countryCode: country))
            return true
        } catch {
            // 22023: сервер отклонил значение, повтор того же id не поможет.
            failedAttempt = (error as? PostgrestError)?.code == "22023" ? nil : attempt
            saveFailed = true
            Self.announce(String(localized: "home_timeline_save_failed"))
            return false
        }
    }

    func clearSaveError() { saveFailed = false }

    /// «Путь поступления: Китай»; для «Пока не решил» и без страны просто
    /// «Путь поступления».
    static func heading(countryCode: String?) -> String {
        guard let name = countryCode.flatMap({ StudyCountries.name(for: $0, kyrgyz: AppLocale.isKyrgyz) }),
              countryCode != CountryTimelineRules.undecided else {
            return String(localized: "home_timeline_heading")
        }
        return String(format: String(localized: "home_timeline_heading_country"), name)
    }

    private static func announce(_ message: String) {
        AccessibilityNotification.Announcement(message).post()
    }
}

/// Цвета блока в одном месте, токены `Theme.swift` сборки 1.0 (#1172):
/// системные `.secondary` и красный дают 3,3..3,4:1 при норме 4,5:1. Этим
/// цветом идут и заголовки секций, и три оговорки в подвалах (review #1208
/// раунда 2, r2-m1), как у остальных секций «Главной».
private enum TimelinePalette {
    static let secondary = Color.secondaryText
    static let danger = Color.dangerText
}

/// Тон текстовых ссылок «Главной»: `AccentColor` #1172, в тёмной теме его
/// вариант #FF8A8A (7,5:1 на #1C1C1E).
private struct TimelineLinkTint: ViewModifier {
    func body(content: Content) -> some View {
        content.tint(Color("AccentColor"))
    }
}

private extension View {
    func timelineLinkTint() -> some View { modifier(TimelineLinkTint()) }
}

struct CountryTimelineSection: View {
    @ObservedObject var model: CountryTimelineModel

    private var kyrgyz: Bool { AppLocale.isKyrgyz }

    private var choice: StudentCountryChoice? {
        if case .loaded(let choice) = model.read { return choice }
        return nil
    }

    private func sourceNote(_ source: StudentCountryChoice.Source) -> LocalizedStringKey? {
        switch source {
        case .application: return "home_timeline_source_application"
        case .case: return "home_timeline_source_case"
        case .saved, .none: return nil
        }
    }

    private var view: CountryTimelineView? {
        guard let country = choice?.country else { return nil }
        return model.library?.select(choice: country, kyrgyz: kyrgyz, today: CountryTimelineLibrary.today())
    }

    private func phaseKey(_ view: CountryTimelineView?) -> String {
        switch model.read {
        case .loading: return "loading"
        case .failed: return "failed"
        case .loaded(let choice):
            if choice.country == nil { return "choose" }
            return view == nil ? "unavailable" : "timeline"
        }
    }

    var body: some View {
        let view = self.view
        let phase = phaseKey(view)
        Section {
            Group {
                switch model.read {
                case .loading:
                    ProgressView()
                case .failed:
                    CountryChoiceCard(model: model, readFailed: true)
                case .loaded(let choice):
                    if choice.country == nil {
                        CountryChoiceCard(model: model, readFailed: false)
                    } else if let view {
                        timeline(view, choice: choice)
                    } else {
                        unavailableRow
                    }
                }
            }
            .motionStagger(index: 1, key: "home.timeline.\(phase)")
            .id(phase)
        } header: {
            Text(heading(view)).foregroundStyle(TimelinePalette.secondary)
        } footer: {
            if let view { CountryTimelineDisclaimers(texts: view.disclaimers) }
        }
    }

    /// «Путь поступления: Китай»; для «Пока не решил» и до выбора без страны.
    private func heading(_ view: CountryTimelineView?) -> String {
        CountryTimelineModel.heading(countryCode: view?.countryCode)
    }

    @ViewBuilder
    private func timeline(_ view: CountryTimelineView, choice: StudentCountryChoice) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(view.intakeLabel).font(.subheadline.weight(.semibold))
            if let note = view.intakeNote {
                Text(note).font(.footnote).foregroundStyle(TimelinePalette.secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        ForEach(view.steps) { step in
            CountryTimelineStepRow(step: step, total: view.steps.count, disclaimers: view.disclaimers)
        }
        VStack(alignment: .leading, spacing: 2) {
            CountryChoiceButton(model: model, current: choice)
            // Вывод по умолчанию называет свой источник (план §8.3), как у веба.
            if let note = sourceNote(choice.source) {
                Text(note).font(.footnote).foregroundStyle(TimelinePalette.secondary)
            }
        }
    }

    /// Общий маршрут не разобрался (дефект сборки, тесты его не пропускают):
    /// повтор чтения не поможет, поэтому кнопки «Обновить» нет.
    private var unavailableRow: some View {
        Text("home_timeline_unavailable").foregroundStyle(TimelinePalette.secondary)
    }
}

// MARK: - Шаг

private struct CountryTimelineStepRow: View {
    let step: CountryTimelineView.Step
    let total: Int
    let disclaimers: [String]
    @State private var isPresented = false
    @ScaledMetric(relativeTo: .subheadline) private var badge: CGFloat = 30
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let rowPadding: CGFloat = 12

    private var isFirst: Bool { step.order == 1 }
    private var isLast: Bool { step.order == total }
    private var stepOf: String { String(format: String(localized: "home_timeline_step_of"), step.order, total) }

    var body: some View {
        // На крупном шрифте (размеры доступности) линия и шеврон отнимают
        // ширину у текста: шаг становится обычной строкой с подписью «Шаг N из M».
        let stacked = dynamicTypeSize.isAccessibilitySize
        Button { isPresented = true } label: {
            HStack(alignment: .top, spacing: 14) {
                if !stacked { rail }
                // Цвета заданы явно: кнопка строки красит иерархические
                // стили (.primary, .secondary) своим тоном.
                VStack(alignment: .leading, spacing: 4) {
                    if stacked {
                        Text(verbatim: stepOf).font(.subheadline.weight(.semibold)).foregroundStyle(TimelinePalette.secondary)
                    }
                    Text(step.title).font(.headline).foregroundStyle(Color.primary)
                    if let timing = step.timing { TimelineTimingLabel(text: timing) }
                    Text(step.summary).font(.subheadline).foregroundStyle(TimelinePalette.secondary)
                }
                .multilineTextAlignment(.leading)
                .padding(.vertical, rowPadding)
                Spacer(minLength: 0)
                if !stacked {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color(uiColor: .tertiaryLabel))
                        .padding(.top, rowPadding + 4)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .contentShape(Rectangle())
        }
        .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
        .listRowSeparator(stacked ? .automatic : .hidden, edges: stacked || !isLast ? .all : .top)
        .accessibilityLabel(Text(verbatim: stepOf + ". " + step.title))
        .accessibilityValue(Text(verbatim: [step.timing, step.summary].compactMap { $0 }.joined(separator: ". ")))
        .accessibilityHint(Text("home_timeline_step_hint"))
        .sheet(isPresented: $isPresented) {
            CountryTimelineStepSheet(step: step, total: total, disclaimers: disclaimers)
        }
    }

    /// Номер шага на вертикальной линии пути. Линия идёт от первого шага до
    /// последнего; без отметки «вы здесь» (путь общий, не личный).
    private var rail: some View {
        ZStack(alignment: .top) {
            VStack(spacing: 0) {
                Rectangle().fill(isFirst ? Color.clear : Color(uiColor: .systemGray4))
                    .frame(width: 2, height: rowPadding + badge / 2)
                Rectangle().fill(isLast ? Color.clear : Color(uiColor: .systemGray4))
                    .frame(width: 2)
                    .frame(maxHeight: .infinity)
            }
            Text(verbatim: String(step.order))
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(Color.primary)
                .frame(width: badge, height: badge)
                .background(Circle().fill(Color(uiColor: .systemGray5)))
                .overlay(Circle().strokeBorder(Color(uiColor: .systemGray4), lineWidth: 1))
                .padding(.top, rowPadding)
        }
        .frame(width: badge)
        .accessibilityHidden(true)
    }
}

private struct CountryTimelineStepSheet: View {
    let step: CountryTimelineView.Step
    let total: Int
    let disclaimers: [String]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(step.title)
                            .font(.title2.bold())
                            .accessibilityAddTraits(.isHeader)
                        if let timing = step.timing { TimelineTimingLabel(text: timing) }
                        Text(step.summary)
                        if let note = step.note {
                            Text(note).font(.footnote).foregroundStyle(TimelinePalette.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                Section {
                    ForEach(step.items) { item in CountryTimelineItemRow(item: item) }
                } header: {
                    Text("home_timeline_checklist_heading").foregroundStyle(TimelinePalette.secondary)
                }
                Section {
                    Label {
                        Text(step.doneWhen)
                    } icon: {
                        Image(systemName: "checkmark.circle").foregroundStyle(TimelinePalette.secondary)
                    }
                } header: {
                    Text("home_timeline_done_when_heading").foregroundStyle(TimelinePalette.secondary)
                } footer: {
                    if step.links.isEmpty { CountryTimelineDisclaimers(texts: disclaimers) }
                }
                if !step.links.isEmpty {
                    Section {
                        // Модулей приложения (CSCA) на iPhone пока нет: ссылки
                        // ведут на внешний адрес (контракт §3, п. 6). S5: когда
                        // появится экран CSCA и в `select` придут `modules`,
                        // здесь нужна и внутренняя ссылка, иначе она пропадёт.
                        ForEach(step.links.filter(\.external)) { link in
                            if let url = URL(string: link.href) {
                                Link(destination: url) {
                                    Label(link.label, systemImage: "arrow.up.right.square")
                                }
                                .timelineLinkTint()
                                .accessibilityHint(Text("home_timeline_external_hint"))
                            }
                        }
                    } header: {
                        Text("home_timeline_links_heading").foregroundStyle(TimelinePalette.secondary)
                    } footer: {
                        CountryTimelineDisclaimers(texts: disclaimers)
                    }
                }
            }
            .navigationTitle(String(format: String(localized: "home_timeline_step_of"), step.order, total))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("close_button") { dismiss() }
                }
            }
        }
        .presentationDragIndicator(.visible)
    }
}

private struct CountryTimelineItemRow: View {
    let item: CountryTimelineView.Item

    private var symbol: String {
        switch item.who {
        case .student: return "person"
        case .evo: return "person.2"
        case .university: return "graduationcap"
        case .embassy: return "building.columns"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(item.whoLabel, systemImage: symbol)
                .font(.caption.weight(.medium))
                .foregroundStyle(TimelinePalette.secondary)
            if let appliesTo = item.appliesTo {
                Text(appliesTo).font(.subheadline.weight(.semibold))
            }
            Text(item.text)
            if let note = item.note {
                Text(note).font(.footnote).foregroundStyle(TimelinePalette.secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Срок шага: значок календаря и текст («Ноябрь и декабрь 2026»).
private struct TimelineTimingLabel: View {
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "calendar").imageScale(.small).accessibilityHidden(true)
            Text(text)
        }
        .font(.subheadline)
        .foregroundStyle(TimelinePalette.secondary)
    }
}

/// Три оговорки (сроки, документы, решения): под таймлайном и в листе шага.
private struct CountryTimelineDisclaimers: View {
    let texts: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(texts, id: \.self) { Text($0) }
        }
        .foregroundStyle(TimelinePalette.secondary)
        .padding(.top, 4)
    }
}

// MARK: - Выбор страны

/// Вариант выбора: код для `set_student_country_choice_v1` и название.
private struct CountryChoiceOption: Identifiable {
    let code: String
    let label: String
    var id: String { code }

    /// Шесть стран продукта, затем «Пока не решил» (study-countries.json).
    static func all(kyrgyz: Bool) -> (countries: [CountryChoiceOption], undecided: CountryChoiceOption?) {
        let countries = StudyCountries.options(kyrgyz: kyrgyz).map { CountryChoiceOption(code: $0.code, label: $0.label) }
        let undecided = StudyCountries.name(for: StudyCountries.undecidedCode, kyrgyz: kyrgyz)
            .map { CountryChoiceOption(code: CountryTimelineRules.undecided, label: $0) }
        return (countries, undecided)
    }
}

/// Карточка «Выберите страну»: выбора нет (source = none) или его не
/// удалось прочитать (`readFailed`, тогда над вариантами честная плашка).
private struct CountryChoiceCard: View {
    @ObservedObject var model: CountryTimelineModel
    let readFailed: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let options = CountryChoiceOption.all(kyrgyz: AppLocale.isKyrgyz)
        let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: dynamicTypeSize.isAccessibilitySize ? 1 : 2)
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("home_timeline_choose_title")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                // Без fixedSize строка карточки в List обрезала вводную до одной строки.
                Text("home_timeline_choose_lead")
                    .font(.subheadline)
                    .foregroundStyle(TimelinePalette.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if readFailed {
                CountryTimelineNotice(text: "home_timeline_read_failed")
                Button("retry_button") { Task { await model.load() } }
                    .timelineLinkTint()
                    .frame(minHeight: 44)
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                ForEach(options.countries) { option in choiceButton(option) }
            }
            if let undecided = options.undecided { choiceButton(undecided) }
            if model.saveFailed { CountryChoiceError() }
        }
        .padding(.vertical, 8)
    }

    private func choiceButton(_ option: CountryChoiceOption) -> some View {
        Button {
            Task { await model.choose(option.code) }
        } label: {
            ZStack {
                Text(option.label)
                    .foregroundStyle(Color.primary)
                    .multilineTextAlignment(.center)
                    .opacity(model.savingCountry == option.code ? 0 : 1)
                if model.savingCountry == option.code { ProgressView() }
            }
            .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
        .tint(Color(uiColor: .systemGray))
        .disabled(model.savingCountry != nil)
        .accessibilityLabel(Text(verbatim: option.label))
    }
}

/// Плашка ошибки блока: значок и текст (сохранение или чтение выбора).
private struct CountryTimelineNotice: View {
    let text: LocalizedStringKey

    var body: some View {
        Label {
            Text(text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(TimelinePalette.danger)
                .accessibilityHidden(true)
        }
        .font(.subheadline)
    }
}

private struct CountryChoiceError: View {
    var body: some View { CountryTimelineNotice(text: "home_timeline_save_failed") }
}

/// «Сменить страну» под таймлайном: лист с шестью странами и «Пока не решил».
private struct CountryChoiceButton: View {
    @ObservedObject var model: CountryTimelineModel
    let current: StudentCountryChoice?
    @State private var isPresented = false

    var body: some View {
        Button("home_timeline_change_country") {
            model.clearSaveError()
            isPresented = true
        }
        .timelineLinkTint()
        .sheet(isPresented: $isPresented) {
            CountryChoiceSheet(model: model, current: current)
        }
    }
}

private struct CountryChoiceSheet: View {
    @ObservedObject var model: CountryTimelineModel
    let current: StudentCountryChoice?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let options = CountryChoiceOption.all(kyrgyz: AppLocale.isKyrgyz)
        NavigationStack {
            List {
                if model.saveFailed {
                    Section { CountryChoiceError() }
                }
                Section {
                    ForEach(options.countries) { option in row(option) }
                } header: {
                    Text("home_timeline_change_lead").textCase(nil).foregroundStyle(TimelinePalette.secondary)
                }
                if let undecided = options.undecided {
                    Section { row(undecided) }
                }
            }
            .navigationTitle("home_timeline_choose_title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("close_button") { dismiss() }
                        .timelineLinkTint()
                }
            }
        }
        // Во весь рост: все семь вариантов видны без прокрутки.
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(model.savingCountry != nil)
    }

    private func row(_ option: CountryChoiceOption) -> some View {
        let selected = current?.country == option.code
        return Button {
            Task {
                // Уже сохранённый выбор не отправляется второй раз.
                if selected && current?.source == .saved { dismiss(); return }
                if await model.choose(option.code) { dismiss() }
            }
        } label: {
            HStack {
                Text(option.label).foregroundStyle(Color.primary)
                Spacer()
                if model.savingCountry == option.code {
                    ProgressView()
                } else if selected {
                    // Выбор озвучивает признак .isSelected; значок читалке не нужен.
                    Image(systemName: "checkmark").font(.body.weight(.semibold)).timelineLinkTint().foregroundStyle(.tint)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .disabled(model.savingCountry != nil)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
