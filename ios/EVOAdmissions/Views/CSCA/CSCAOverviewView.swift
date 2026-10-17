import ImageIO
import SwiftUI
import UIKit

/// Обзор экзамена над занятиями на главной CSCA (решение владельца
/// 17.10.2026, контракт docs/portal/csca-contract.md §19): что такое CSCA,
/// кому он нужен, предметы и формат, стоимость, вопросы. Тексты и таблицы из
/// того же src/content/csca/overview.json, что у веба (`CSCAOverviewContent`).
/// Новичок видит обзор открытым, тот, кто уже занимается, свёрнутым в одну
/// строку; свой выбор зритель меняет кнопкой «Об экзамене», устройство
/// помнит его в UserDefaults (`csca_overview`, как cookie веба).
///
/// Секции встают прямо в `List` главной (`.insetGrouped`), без своих
/// карточек: тот же облик, что у остальных секций CSCA.
struct CSCAOverviewSections: View {
    let content: CSCAOverviewContent
    /// Студент уже занимается: без выбора обзор свёрнут.
    let started: Bool
    /// На главной есть блок сессий, к нему ведёт ответ о датах.
    let sessionsShown: Bool
    /// Занятия загрузились: под вводным текстом «К занятиям».
    let moduleShown: Bool
    let skipToModule: () -> Void

    @AppStorage(CSCAOverviewChoice.defaultsKey) private var storedChoice = ""
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var openQuestions: Set<String> = []

    private var overview: CSCAOverview { content.overview }
    private var kyrgyz: Bool { AppLocale.isKyrgyz }
    private var open: Bool { CSCAOverviewChoice.isOpen(CSCAOverviewChoice.parse(storedChoice), started: started) }

    private func t(_ pair: CSCABilingual) -> String { kyrgyz ? pair.ky : pair.ru }

    var body: some View {
        Section {
            titleRow
            if open {
                if let hero = content.hero {
                    CSCAOverviewPhotoView(photo: hero, aspect: 3 / 2, creditSubject: overview.exam.short)
                        .listRowInsets(EdgeInsets())
                }
                introRow
            }
        }
        if open {
            audienceSection
            ForEach(Array(overview.subjects.groups.enumerated()), id: \.element.key) { index, group in
                subjectsSection(group, first: index == 0)
            }
            feesSection
            faqSection
        }
    }

    // MARK: Строка с названием и кнопкой

    private var titleRow: some View {
        // При крупном шрифте миниатюра встаёт над текстом: рядом с ней
        // колонка текста теряет треть ширины и сводка идёт в восемь строк.
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
        return layout {
            if !open, let hero = content.hero {
                CSCAOverviewThumb(photo: hero)
            }
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: overview.exam.nameEn)
                        .font(open ? .subheadline : .subheadline.weight(.semibold))
                        .foregroundStyle(open ? CSCAColor.secondaryText : Color.primary)
                        .accessibilityLabel(Text(CSCASpeech.english(overview.exam.nameEn)))
                    if !open {
                        Text(verbatim: t(overview.summary))
                            .font(.subheadline)
                            .foregroundStyle(CSCAColor.secondaryText)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .combine)
                toggleButton
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 4)
    }

    private var toggleButton: some View {
        Button {
            let next: CSCAOverviewChoice = open ? .closed : .open
            withAnimation(reduceMotion ? nil : Motion.base) { storedChoice = next.rawValue }
        } label: {
            HStack(spacing: 6) {
                Text(csca: "csca_overview_toggle")
                Image(systemName: "chevron.down")
                    .imageScale(.small)
                    .rotationEffect(.degrees(open ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.primary)
            .frame(minHeight: 44)
        }
        // Нейтральная, как на вебе: красным на экране остаются ссылки и
        // главное действие занятий, а не сворачивание справки. Серый тон с
        // основным текстом, как кнопки выбора страны (FillContrastSourceTests).
        .buttonStyle(.bordered)
        .tint(Color(uiColor: .systemGray))
        .accessibilityValue(Text(csca: open ? "csca_overview_state_open" : "csca_overview_state_closed"))
    }

    // MARK: Что такое CSCA

    private var introRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(overview.intro.enumerated()), id: \.offset) { index, paragraph in
                Text(verbatim: t(paragraph))
                    .font(index == 0 ? .title3.weight(.semibold) : .body)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if moduleShown {
                // Кто уже знает экзамен, не листает обзор до занятий.
                Button(action: skipToModule) {
                    Label {
                        Text(csca: "csca_overview_skip")
                    } icon: {
                        Image(systemName: "arrow.down")
                    }
                    .font(.body.weight(.semibold))
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.borderless)
                .tint(CSCAColor.accentText)
            }
        }
        .padding(.vertical, 6)
    }

    // MARK: Кому нужен

    private var audienceSection: some View {
        Section {
            if let photo = content.audience {
                CSCAOverviewPhotoView(photo: photo, aspect: 16 / 9, creditSubject: t(overview.audience.title))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.vertical, 6)
            }
            verdictRow(overview.audience.needed, needed: true)
            verdictRow(overview.audience.notNeeded, needed: false)
        } header: {
            CSCAOverviewHeading(text: t(overview.audience.title))
        }
    }

    private func verdictRow(_ verdict: CSCAOverviewVerdict, needed: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: needed ? "checkmark.circle.fill" : "minus.circle")
                .font(.title3)
                .foregroundStyle(needed ? Color.primary : CSCAColor.secondaryText)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: t(verdict.label))
                    .font(.headline)
                Text(verbatim: t(verdict.text))
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    // MARK: Предметы и формат

    /// Группа предметов своей карточкой: название, общие факты группы один
    /// раз (как узкая таблица веба), ниже предметы с «В EVO». VoiceOver
    /// читает у каждого предмета все четыре факта по порядку столбцов
    /// таблицы веба, поэтому сетка общих фактов скрыта от него.
    private func subjectsSection(_ group: CSCAOverviewGroup, first: Bool) -> some View {
        let facts = overview.groupFacts(group, kyrgyz: kyrgyz)
        return Section {
            VStack(alignment: .leading, spacing: 12) {
                (Text(verbatim: group.nameEn).font(.headline)
                    + Text(verbatim: "  ")
                    + Text(verbatim: t(group.name)).font(.subheadline).foregroundStyle(CSCAColor.secondaryText))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(Text(CSCASpeech.english(group.nameEn)) + Text(verbatim: " " + t(group.name)))
                    .accessibilityAddTraits(.isHeader)
                if !facts.shared.isEmpty {
                    CSCAOverviewFactGrid(facts: facts.shared)
                        .accessibilityHidden(true)
                }
            }
            .padding(.vertical, 6)
            ForEach(group.subjects, id: \.key) { subject in
                subjectRow(subject, own: facts.bySubject[subject.key] ?? [])
            }
        } header: {
            if first { CSCAOverviewHeading(text: t(overview.subjects.title)) }
        }
    }

    private func subjectRow(_ subject: CSCAOverviewSubject, own: [CSCASubjectFact]) -> some View {
        let status = "\(t(overview.subjects.columns.evo)): \(overview.subjects.evoStatus[subject.evo].map(t) ?? subject.evo.rawValue)"
        let available = subject.evo == .available
        var name = Text(verbatim: subject.nameEn).font(.body.weight(.semibold))
        if let local = subject.name {
            name = name + Text(verbatim: "  ") + Text(verbatim: t(local)).font(.subheadline).foregroundStyle(CSCAColor.secondaryText)
        }
        return VStack(alignment: .leading, spacing: 6) {
            name.fixedSize(horizontal: false, vertical: true)
            // Значок у первой строки статуса: при переносе он не отрывается
            // от текста (review дизайна веба раунда 3, R2).
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: available ? "circle.fill" : "circle")
                    .font(.caption2)
                    .foregroundStyle(available ? CSCAColor.ok : CSCAColor.secondaryText)
                Text(verbatim: status)
                    .font(available ? .subheadline.weight(.semibold) : .subheadline)
                    .foregroundStyle(available ? Color.primary : CSCAColor.secondaryText)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !own.isEmpty { CSCAOverviewFactGrid(facts: own) }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(subjectSpeech(subject, status: status))
    }

    /// «Mathematics, математика. Язык теста: … Время: … Вопросов с выбором
    /// ответа: … Шкала баллов: … В EVO: Уроки и тесты.»
    private func subjectSpeech(_ subject: CSCAOverviewSubject, status: String) -> Text {
        var speech = Text(CSCASpeech.english(subject.nameEn))
        if let local = subject.name { speech = speech + Text(verbatim: ", " + t(local)) }
        for fact in overview.subjectFacts(subject, kyrgyz: kyrgyz) {
            speech = speech + Text(verbatim: ". \(fact.label): \(fact.value)")
        }
        return speech + Text(verbatim: ". " + status)
    }

    // MARK: Стоимость

    private var feesSection: some View {
        let fees = overview.fees
        let rowLayout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
        return Section {
            // Подписи столбцов в той же раскладке, что строки: при крупном
            // шрифте строка идёт в две строчки, и подписи тоже.
            rowLayout {
                Text(verbatim: t(fees.subjectsColumn))
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 12) }
                Text(verbatim: t(fees.feeColumn))
            }
            .font(.footnote.weight(.medium))
            .foregroundStyle(CSCAColor.secondaryText)
            .accessibilityHidden(true)
            ForEach(fees.rows, id: \.key) { row in
                rowLayout {
                    Text(verbatim: t(row.label))
                        .font(.body)
                    if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 12) }
                    Text(verbatim: String(row.fee))
                        .font(.body.weight(.semibold).monospacedDigit())
                }
                .frame(minHeight: 44)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: "\(t(fees.subjectsColumn)): \(t(row.label)). \(t(fees.feeColumn)): \(row.fee)"))
            }
        } header: {
            CSCAOverviewHeading(text: t(fees.title))
        }
    }

    // MARK: Вопросы

    private var faqSection: some View {
        Section {
            ForEach(overview.faq.items, id: \.id) { item in
                DisclosureGroup(isExpanded: questionBinding(item.id)) {
                    answer(item)
                } label: {
                    Text(verbatim: t(item.question))
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Color.primary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 6)
                }
                .tint(CSCAColor.accentText)
            }
        } header: {
            CSCAOverviewHeading(text: t(overview.faq.title))
        } footer: {
            // Системный цвет подвала секции даёт 3.29:1 на сгруппированном
            // фоне в светлой теме; тон палитры держит 6.12:1 и 9.43:1.
            Text(verbatim: CSCAText.f("csca_overview_checked", CSCATime.dayWithYearLabel(overview.confirmedOn, locale: AppLocale.current)))
                .foregroundStyle(CSCAColor.secondaryText)
                .padding(.top, 4)
        }
    }

    @ViewBuilder
    private func answer(_ item: CSCAOverviewFaqItem) -> some View {
        if let link = item.link, !sessionsShown {
            answerText(t(link.withoutSessions))
        } else {
            ForEach(Array(item.answer.enumerated()), id: \.offset) { _, part in
                answerText(t(part))
            }
        }
        if let link = item.link, sessionsShown {
            // Даты не перечисляются: ответ ведёт к официальному календарю
            // сессий из базы (286), тот же экран, что у секции «Сессии CSCA».
            NavigationLink(value: CSCARoute.sessions) {
                Text(verbatim: t(link.label))
                    .font(.body.weight(.semibold))
                    .foregroundStyle(CSCAColor.accentText)
                    .frame(minHeight: 44, alignment: .leading)
            }
        }
    }

    private func answerText(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.body)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, 2)
    }

    private func questionBinding(_ id: String) -> Binding<Bool> {
        Binding(
            get: { openQuestions.contains(id) },
            set: { isOpen in
                withAnimation(reduceMotion ? nil : Motion.fast) {
                    if isOpen { openQuestions.insert(id) } else { openQuestions.remove(id) }
                }
            }
        )
    }
}

/// Заголовок секции обзора: крупнее обычной подписи секции, как заголовки
/// второго уровня веба, без верхнего регистра.
private struct CSCAOverviewHeading: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(.title3.weight(.semibold))
            .foregroundStyle(Color.primary)
            .textCase(nil)
            .accessibilityAddTraits(.isHeader)
            .padding(.top, 8)
    }
}

/// Факты подписью над значением: две колонки, при крупном шрифте одна, так
/// что ни подпись, ни значение не обрезаются.
private struct CSCAOverviewFactGrid: View {
    let facts: [CSCASubjectFact]
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if dynamicTypeSize >= .xxxLarge {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(facts, id: \.key) { cell($0) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 10) {
                ForEach(Array(stride(from: 0, to: facts.count, by: 2)), id: \.self) { start in
                    GridRow {
                        cell(facts[start])
                        if start + 1 < facts.count { cell(facts[start + 1]) } else { Color.clear.gridCellUnsizedAxes([.horizontal, .vertical]) }
                    }
                }
            }
        }
    }

    private func cell(_ fact: CSCASubjectFact) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: fact.label)
                .font(.footnote)
                .foregroundStyle(CSCAColor.secondaryText)
            Text(verbatim: fact.value)
                .font(.body.weight(.semibold))
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Фото

/// Фото кампуса из bundle: самый узкий WebP не уже кадра в пикселях (720 для
/// 2x, 1280 для 3x на телефоне), кадр по точке `objectPosition` манифеста, как
/// `object-fit: cover` веба. Место под фото занято с первого кадра, текст под
/// ним не прыгает. Автор и лицензия по кнопке «©», как у фото вузов.
struct CSCAOverviewPhotoView: View {
    let photo: CSCAOverviewPhoto
    let aspect: CGFloat
    /// Что на экране рядом с фото: VoiceOver читает это значением «©».
    let creditSubject: String

    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var width: CGFloat = 0
    @State private var image: UIImage?

    var body: some View {
        let file = width > 0 ? photo.file(forPixelWidth: width * displayScale) : nil
        Color(.tertiarySystemFill)
            .aspectRatio(aspect, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .transition(.opacity)
                }
            }
            .clipped()
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: AppLocale.pick(ru: photo.alt.ru, ky: photo.alt.ky)))
            .accessibilityAddTraits(.isImage)
            .overlay(alignment: .bottomTrailing) {
                AtlasPhotoCreditButton(credit: AtlasPhotoCredit(cscaOverview: photo, subject: creditSubject))
                    .padding(6)
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .task(id: file?.path) {
                guard let file else { return }
                let loaded = await CSCAOverviewImages.image(file, aspect: aspect, focus: photo.focus)
                guard !Task.isCancelled else { return }
                withAnimation(reduceMotion ? nil : Motion.fast) { image = loaded }
            }
    }
}

/// Миниатюра героя в свёрнутой строке, 56 pt (WebP 240 даже на 3x).
private struct CSCAOverviewThumb: View {
    let photo: CSCAOverviewPhoto
    @Environment(\.displayScale) private var displayScale
    @State private var image: UIImage?

    var body: some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Color(.tertiarySystemFill))
            .frame(width: 56, height: 56)
            .overlay {
                if let image {
                    Image(uiImage: image).resizable().scaledToFill()
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .accessibilityHidden(true)
            .task {
                guard let file = photo.file(forPixelWidth: 56 * displayScale) else { return }
                image = await CSCAOverviewImages.image(file, aspect: 1, focus: photo.focus)
            }
    }
}

/// Декодирование вне главного потока и кэш по файлу и кадру.
enum CSCAOverviewImages {
    private static let cache = NSCache<NSString, UIImage>()

    static func image(_ file: CSCAOverviewPhotoFile, aspect: CGFloat, focus: CGPoint) async -> UIImage? {
        let key = "\(file.path)|\(aspect)" as NSString
        if let hit = cache.object(forKey: key) { return hit }
        let name = file.resourceName
        let decoded = await Task.detached(priority: .userInitiated) { () -> UIImage? in
            guard let url = Bundle.main.url(forResource: name, withExtension: nil),
                  let source = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let full = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
            else { return nil }
            let rect = CSCAOverviewPhoto.crop(imageSize: CGSize(width: full.width, height: full.height), aspect: aspect, focus: focus)
            return UIImage(cgImage: full.cropping(to: rect) ?? full)
        }.value
        if let decoded { cache.setObject(decoded, forKey: key) }
        return decoded
    }
}

extension AtlasPhotoCredit {
    /// Фото обзора CSCA, как `PhotoRights` веба: автор ссылкой на страницу
    /// фото Pexels, лицензия ссылкой; Pexels атрибуции не требует, но портал
    /// подписывает каждое фото.
    init(cscaOverview photo: CSCAOverviewPhoto, subject: String) {
        kind = .author
        self.subject = subject
        caption = nil
        author = photo.author
        authorUrl = URL(string: photo.sourceUrl)
        source = nil
        officialUrl = nil
        license = photo.licence
        licenseUrl = URL(string: photo.licenceUrl)
        cropped = false
    }
}
