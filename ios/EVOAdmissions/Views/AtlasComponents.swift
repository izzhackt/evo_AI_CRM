import SwiftUI

/// Общие части экранов «страна → город → вуз» (университеты v2, план 7.4).
/// Цвета подписей проходят 4,5:1 в обеих темах и при «Увеличении
/// контраста» (те же значения, что семантический `SecondaryText` сборки 1.0,
/// PR #1172; после его слияния здесь можно взять `.secondaryText`).
enum AtlasStyle {
    static let secondaryText = Color(uiColor: UIColor { traits in
        let dark = traits.userInterfaceStyle == .dark
        let high = traits.accessibilityContrast == .high
        switch (dark, high) {
        case (false, false): return UIColor(red: 0x63 / 255, green: 0x63 / 255, blue: 0x66 / 255, alpha: 1)
        case (true, false): return UIColor(red: 0xAE / 255, green: 0xAE / 255, blue: 0xB2 / 255, alpha: 1)
        case (false, true): return UIColor(red: 0x48 / 255, green: 0x48 / 255, blue: 0x4A / 255, alpha: 1)
        case (true, true): return UIColor(red: 0xC7 / 255, green: 0xC7 / 255, blue: 0xCC / 255, alpha: 1)
        }
    })
    /// Текст ссылок: глубже фирменного красного в светлой теме, светлее в
    /// тёмной (#D70217 на тёмном фоне даёт меньше 4,5:1).
    static let linkText = Color(uiColor: UIColor { traits in
        let dark = traits.userInterfaceStyle == .dark
        let high = traits.accessibilityContrast == .high
        switch (dark, high) {
        case (false, false): return UIColor(red: 0xB0 / 255, green: 0x00 / 255, blue: 0x16 / 255, alpha: 1)
        case (true, false): return UIColor(red: 0xFF / 255, green: 0x8A / 255, blue: 0x8A / 255, alpha: 1)
        case (false, true): return UIColor(red: 0x8E / 255, green: 0x00 / 255, blue: 0x12 / 255, alpha: 1)
        case (true, true): return UIColor(red: 0xFF / 255, green: 0xA8 / 255, blue: 0xA8 / 255, alpha: 1)
        }
    })
    static let placeholder = Color(.secondarySystemBackground)
    static let surface = Color(.secondarySystemBackground)
    static let cardRadius: CGFloat = 16
    static let elementRadius: CGFloat = 12
}

/// Экран каталога, на который ведёт ссылка.
enum AtlasRoute: Hashable {
    case country(String)
    case city(String)
    case university(UUID)
}

/// Экран маршрута каталога.
struct AtlasRouteView: View {
    let route: AtlasRoute

    var body: some View {
        switch route {
        case .country(let code): CountryAtlasView(code: code)
        case .city(let key): CityAtlasView(cityKey: key)
        case .university(let id): UniversityDetailView(institutionId: id, initialItem: nil)
        }
    }
}

/// Переход внутри каталога ссылкой с экраном (`NavigationLink { … }`), а не
/// по значению. Страницу вуза открывают и стеки «Главной» и «Профессий»
/// ссылкой с экраном; переход по значению из такого экрана SwiftUI ставит
/// под него (аудит UX/UI 2026-10, PR #1172), и «Страна › Город» с вуза из
/// «Избранного» на «Главной» не открывались (прогон 16.10.2026). Ссылка с
/// экраном работает в любом стеке и не требует регистрации экранов.
struct AtlasLink<Label: View>: View {
    let route: AtlasRoute
    @ViewBuilder let label: () -> Label

    var body: some View {
        NavigationLink {
            AtlasRouteView(route: route)
        } label: {
            label()
        }
    }
}

/// «Страна › Город» на странице вуза: страна и город ссылками на свои
/// экраны каталога (план 7.3). Без опубликованного города только страна.
struct UniversityPlaceLinks: View {
    let country: AtlasCountryRef
    let city: AtlasCity?

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) { links }
            VStack(alignment: .leading, spacing: 0) { links }
        }
        .font(.subheadline)
        // VoiceOver называет группу, как `nav` с подписью `breadcrumbAria`
        // на вебе: «Китай» и «Шанхай» читаются как путь по каталогу.
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("catalog_breadcrumb"))
    }

    @ViewBuilder
    private var links: some View {
        link(country.name.text(kyrgyz: AtlasText.kyrgyz), route: .country(country.code))
        if let city {
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(AtlasStyle.secondaryText)
                .accessibilityHidden(true)
            link(city.name.text(kyrgyz: AtlasText.kyrgyz), route: .city(city.key))
        }
    }

    private func link(_ title: String, route: AtlasRoute) -> some View {
        AtlasLink(route: route) {
            Text(title)
                .foregroundStyle(AtlasStyle.linkText)
                .underline()
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Тексты

/// Абзац текста страны или города. SwiftUI `Text` на iOS 26 считал высоту
/// длинного русского абзаца без правила, которое переносит короткие слова
/// («по», «на») на следующую строку, а рисовал с ним: на границе ширины
/// последняя строка обрезалась многоточием (снимок экрана «Китай»,
/// 16.10.2026). `UILabel` меряет и рисует одним набором, Dynamic Type и
/// VoiceOver у него системные.
struct AtlasParagraph: UIViewRepresentable {
    let text: String
    var style: UIFont.TextStyle = .body

    func makeUIView(context: Context) -> UILabel {
        let label = UILabel()
        label.numberOfLines = 0
        label.lineBreakMode = .byWordWrapping
        label.adjustsFontForContentSizeCategory = true
        label.textColor = .label
        label.setContentCompressionResistancePriority(.required, for: .vertical)
        label.setContentHuggingPriority(.defaultLow, for: .horizontal)
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        label.font = .preferredFont(forTextStyle: style, compatibleWith: label.traitCollection)
        label.text = text
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView label: UILabel, context: Context) -> CGSize? {
        let width = proposal.width ?? UIView.layoutFittingExpandedSize.width
        label.preferredMaxLayoutWidth = width
        let size = label.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: ceil(size.height))
    }
}

enum AtlasText {
    static var kyrgyz: Bool { AppLocale.isKyrgyz }

    /// Формы числительного лежат в String Catalog отдельными ключами
    /// `<основа>_one|few|many` (`UniversityAtlasPolicy.pluralForm`).
    static func count(_ base: String, _ value: Int) -> String {
        let key = "\(base)_\(UniversityAtlasPolicy.pluralForm(value, kyrgyz: kyrgyz).rawValue)"
        return String(format: NSLocalizedString(key, comment: ""), locale: AppLocale.current, value)
    }

    static func universities(_ value: Int) -> String { count("catalog_count_universities", value) }
    static func cities(_ value: Int) -> String { count("catalog_count_cities", value) }

    static func countryStats(_ country: AtlasCountry) -> String {
        guard country.universityCount > 0 else { return String(localized: "catalog_country_no_universities_short") }
        return "\(universities(country.universityCount)) · \(cities(country.cityCount))"
    }

    static func levels(_ levels: [String]) -> String? {
        guard !levels.isEmpty else { return nil }
        return levels.map(universityLevelLabel).joined(separator: " · ")
    }

    static func day(_ raw: String) -> String {
        CatalogDate.dayLabel(from: raw, locale: AppLocale.current) ?? raw
    }

    /// «16.10.2026» для строки внутри предложения: длинная русская дата
    /// кончается на «г.», и точка предложения после неё удваивалась бы.
    static func numericDay(_ raw: String) -> String {
        guard AtlasValue.isDay(raw) else { return raw }
        let parts = raw.split(separator: "-")
        return "\(parts[2]).\(parts[1]).\(parts[0])"
    }

    /// «Подача до 31 марта 2027 г.» или «Начало: сентябрь 2027».
    static func nearestIntake(_ intakes: [UniversityIndexIntake], now: Date = Date()) -> String? {
        guard let nearest = UniversityAtlasPolicy.nearestIntake(intakes, now: now) else { return nil }
        switch nearest.kind {
        case .deadline:
            return String(format: String(localized: "catalog_intake_deadline"), day(nearest.value))
        case .start:
            return String(format: String(localized: "catalog_intake_start"), day(nearest.value))
        case .startMonth:
            let month = CatalogDate.monthLabel(from: nearest.value, locale: AppLocale.current) ?? nearest.value
            return String(format: String(localized: "catalog_intake_start"), month)
        }
    }
}

// MARK: - Фото

/// Что за фото: страна или город (путь в бакете) либо вуз (ключ библиотеки).
enum AtlasPhotoSubject: Hashable {
    case geography(AtlasPhoto)
    case university(photoKey: String?)

    /// Есть ли фото для студента. Фото страны и города всегда лежит в
    /// бакете (путь проверен разбором индекса); фото вуза только
    /// перенесённой копией (`AtlasPhotoURL.university`).
    var isAvailable: Bool {
        switch self {
        case .geography:
            return true
        case .university(let photoKey):
            return AtlasPhotoURL.hasUniversityPhoto(
                photoKey: photoKey,
                library: UniversityPhotoLibrary.shared,
                manifest: UniversityPhotoManifest.shared
            )
        }
    }

    func source(width: Int) -> AtlasPhotoSource {
        switch self {
        case .geography(let photo):
            return AtlasPhotoURL.geography(photo, base: AppConfig.supabaseURL, width: width)
        case .university(let photoKey):
            return AtlasPhotoURL.university(
                photoKey: photoKey,
                library: UniversityPhotoLibrary.shared,
                manifest: UniversityPhotoManifest.shared,
                base: AppConfig.supabaseURL,
                width: width
            )
        }
    }
}

/// Фото с постоянными пропорциями: место под фото не прыгает при загрузке,
/// вариант размера под ширину карточки, кэш на диске и в памяти. Фото это
/// содержание карточки, а не подпись: для VoiceOver его описывает карточка
/// или кнопка «©». Фото вуза без перенесённой копии не грузится: на его
/// месте заглушка «Проверенное фото кампуса пока не добавлено», как на вебе
/// (в маленькой миниатюре строки значок), а не пустой серый прямоугольник,
/// похожий на загрузку.
struct AtlasPhotoView: View {
    let subject: AtlasPhotoSubject
    var aspectRatio: CGFloat = 4 / 3
    var cornerRadius: CGFloat = AtlasStyle.cardRadius
    /// Миниатюра строки (64 pt): заглушка значком, текст туда не помещается.
    var compact = false

    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var size: CGSize = .zero
    @State private var image: UIImage?
    @State private var failed = false

    private struct LoadKey: Hashable {
        let subject: AtlasPhotoSubject
        let width: Int
    }

    private var widthStep: Int {
        AtlasPhotoURL.widthStep(points: Double(max(size.width, size.height * aspectRatio)), scale: Double(displayScale))
    }

    var body: some View {
        if subject.isAvailable {
            photo
        } else {
            missing
        }
    }

    private var missing: some View {
        AtlasStyle.placeholder
            .aspectRatio(aspectRatio, contentMode: .fit)
            .overlay {
                if compact {
                    Image(systemName: "building.columns")
                        .font(.title3)
                        .foregroundStyle(AtlasStyle.secondaryText)
                } else {
                    Text("university_photo_missing")
                        .font(.footnote)
                        .foregroundStyle(AtlasStyle.secondaryText)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 16)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    private var photo: some View {
        AtlasStyle.placeholder
            .aspectRatio(aspectRatio, contentMode: .fit)
            .overlay {
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                        .transition(.opacity)
                } else if failed {
                    Image(systemName: "photo")
                        .font(.title2)
                        .foregroundStyle(AtlasStyle.secondaryText)
                        .accessibilityLabel(Text("catalog_photo_failed"))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .task(id: size.width > 0 ? LoadKey(subject: subject, width: widthStep) : nil) {
                guard size.width > 0 else { return }
                let source = subject.source(width: widthStep)
                // Адресов нет (путь не прошёл проверку): фото просто нет, а
                // не «фото не загрузилось».
                guard !source.candidates.isEmpty else {
                    image = nil
                    failed = false
                    return
                }
                let loaded = await AtlasImageLoader.shared.image(for: source, maxPixel: widthStep)
                guard !Task.isCancelled else { return }
                withAnimation(reduceMotion ? nil : Motion.fast) {
                    image = loaded
                    failed = loaded == nil
                }
            }
    }
}

/// Автор, источник и лицензия фото по кнопке «©» (план 4.4): подпись под
/// карточкой не печатается. У официальных медиа вуза (решение владельца Р3)
/// вместо служебной строки лицензии «Фото: <вуз>, официальный сайт», как
/// `photoCreditOfficial` веба.
struct AtlasPhotoCredit: Equatable {
    enum Kind: Equatable {
        case author
        /// Фото с собственного сайта вуза: название вуза для подписи.
        case official(university: String)
    }

    let kind: Kind
    let caption: String?
    let author: String
    let authorUrl: URL?
    let sourceName: String?
    let sourceUrl: URL?
    let license: String
    let licenseUrl: URL?
    let cropped: Bool

    init(_ photo: AtlasPhoto) {
        kind = .author
        caption = nil
        author = photo.author
        authorUrl = photo.authorUrl
        sourceName = photo.sourceName
        sourceUrl = photo.sourceUrl
        license = photo.license
        licenseUrl = photo.licenseUrl
        cropped = true
    }

    /// Подпись фото вуза; nil, если фото студенту не показывается (ключ
    /// неизвестен или копия не перенесена): тогда и кнопки «©» нет.
    init?(universityPhotoKey: String?, universityName: String) {
        guard AtlasPhotoSubject.university(photoKey: universityPhotoKey).isAvailable,
              let photo = UniversityPhotoLibrary.photo(for: universityPhotoKey) else { return nil }
        kind = UniversityPhotoRights.isOfficialMedia(license: photo.license) ? .official(university: universityName) : .author
        caption = photo.caption
        author = photo.author
        authorUrl = nil
        sourceName = nil
        sourceUrl = URL(string: photo.sourceUrl)
        license = photo.license
        licenseUrl = URL(string: photo.licenseUrl)
        cropped = true
    }
}

struct AtlasPhotoCreditButton: View {
    let credit: AtlasPhotoCredit
    @State private var shows = false

    var body: some View {
        Button {
            shows = true
        } label: {
            Image(systemName: "c.circle")
                .font(.body.weight(.semibold))
                .foregroundStyle(.primary)
                .frame(width: 32, height: 32)
                .background(.regularMaterial, in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("catalog_photo_credit"))
        .popover(isPresented: $shows) {
            // Ширина задана точно: у кнопки в левом углу карточки стрелка
            // боковая, и при ширине «от и до» высота считалась для другой
            // ширины, подпись обрезалась. При крупном шрифте текст
            // прокручивается внутри.
            ScrollView {
                creditContent
            }
            .frame(width: 300)
            .presentationCompactAdaptation(.popover)
        }
    }

    private var creditContent: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let caption = credit.caption {
                Text(caption)
                    .font(.subheadline)
                    .padding(.bottom, 4)
            }
            switch credit.kind {
            case .official(let university):
                creditLine(String(format: String(localized: "catalog_photo_official"), university), url: credit.sourceUrl)
            case .author:
                creditLine(String(format: String(localized: "university_photo_by"), credit.author), url: credit.authorUrl ?? credit.sourceUrl)
                if let sourceName = credit.sourceName {
                    creditLine(String(format: String(localized: "catalog_photo_source"), sourceName), url: credit.sourceUrl)
                }
                creditLine(String(format: String(localized: "catalog_photo_license"), credit.license), url: credit.licenseUrl)
            }
            if credit.cropped {
                Text("university_photo_crop")
                    .font(.footnote)
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .padding(.top, 4)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(16)
        .frame(width: 300, alignment: .leading)
    }

    @ViewBuilder
    private func creditLine(_ text: String, url: URL?) -> some View {
        if let url {
            Link(destination: url) {
                HStack(spacing: 6) {
                    Text(text).multilineTextAlignment(.leading)
                    Image(systemName: "arrow.up.right").imageScale(.small).accessibilityHidden(true)
                }
                .font(.subheadline)
                .foregroundStyle(AtlasStyle.linkText)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
        } else {
            Text(text)
                .font(.subheadline)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        }
    }
}

/// Шапка страны или города: фото во всю ширину и «©» в углу.
struct AtlasHeaderPhoto: View {
    let photo: AtlasPhoto?

    var body: some View {
        if let photo {
            AtlasPhotoView(subject: .geography(photo), aspectRatio: 3 / 2)
                .accessibilityHidden(true)
                .overlay(alignment: .bottomTrailing) {
                    AtlasPhotoCreditButton(credit: AtlasPhotoCredit(photo))
                        .padding(6)
                }
        }
    }
}

// MARK: - Сердечко

/// Сердечко избранного (195) с зоной нажатия 44 pt. `onPhoto`: подложка из
/// материала, чтобы значок читался поверх любого фото.
struct AtlasHeartButton: View {
    let institutionId: UUID
    @ObservedObject var store: FavoritesStore
    var onPhoto = false

    var body: some View {
        FavoriteHeartButton(institutionId: institutionId, store: store)
            .font(.body.weight(.semibold))
            .frame(width: onPhoto ? 34 : 44, height: onPhoto ? 34 : 44)
            .background {
                if onPhoto { Circle().fill(.regularMaterial) }
            }
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
    }
}

// MARK: - Строки и карточки вузов

/// Компактная строка вуза: поиск и «Другие вузы страны».
struct UniversityIndexRow: View {
    let university: UniversityIndexEntry
    let place: String?
    @ObservedObject var favorites: FavoritesStore

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            AtlasLink(route: .university(university.id)) {
                HStack(alignment: .center, spacing: 12) {
                    AtlasPhotoView(subject: .university(photoKey: university.photoKey), aspectRatio: 1, cornerRadius: AtlasStyle.elementRadius, compact: true)
                        .frame(width: 64, height: 64)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(university.name)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        if let place {
                            Text(place)
                                .font(.subheadline)
                                .foregroundStyle(AtlasStyle.secondaryText)
                        }
                        if let levels = AtlasText.levels(university.levels) {
                            Text(levels)
                                .font(.footnote)
                                .foregroundStyle(AtlasStyle.secondaryText)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.vertical, 8)
                .contentShape(Rectangle())
                .accessibilityElement(children: .combine)
            }
            .buttonStyle(.pressable)
            AtlasHeartButton(institutionId: university.id, store: favorites)
        }
    }
}

/// Карточка вуза на экране города (план 7.3): фото нужного размера,
/// название, уровни, ближайший набор, сердечко.
struct UniversityAtlasCard: View {
    let university: UniversityIndexEntry
    @ObservedObject var favorites: FavoritesStore

    var body: some View {
        AtlasLink(route: .university(university.id)) {
            VStack(alignment: .leading, spacing: 10) {
                AtlasPhotoView(subject: .university(photoKey: university.photoKey), aspectRatio: 16 / 9)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(university.name)
                        .font(.headline)
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.leading)
                        .padding(.trailing, 4)
                    if let levels = AtlasText.levels(university.levels) {
                        Text(levels)
                            .font(.subheadline)
                            .foregroundStyle(AtlasStyle.secondaryText)
                    }
                    if let intake = AtlasText.nearestIntake(university.intakes) {
                        Label {
                            Text(intake)
                        } icon: {
                            Image(systemName: "calendar")
                                .accessibilityHidden(true)
                        }
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .padding(.top, 2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
            .accessibilityElement(children: .combine)
        }
        .buttonStyle(.pressable)
        .overlay(alignment: .topTrailing) {
            AtlasHeartButton(institutionId: university.id, store: favorites, onPhoto: true)
                .padding(6)
        }
        // «©» на фото карточки, как на вебе; справа уже сердечко.
        .overlay(alignment: .topLeading) {
            if let credit = AtlasPhotoCredit(universityPhotoKey: university.photoKey, universityName: university.name) {
                AtlasPhotoCreditButton(credit: credit)
                    .padding(6)
            }
        }
    }
}

// MARK: - Состояния

struct AtlasMessageView: View {
    let title: LocalizedStringKey
    var message: LocalizedStringKey?
    var systemImage = "building.columns"
    var retry: (() async -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            if let message { Text(message) }
        } actions: {
            if let retry {
                Button("retry_button") { Task { await retry() } }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
            }
        }
    }
}

/// Индекса нет ни на диске, ни с сервера: сеть не ответила (подсказка про
/// интернет) или ответ нельзя показать (нейтральная подсказка, сеть ни при
/// чём). Повтор сверяет индекс заново. Один вид на корне вкладки, на
/// экранах страны и города.
struct AtlasIndexFailureView: View {
    let failure: UniversityIndexStore.Failure
    @ObservedObject var store: UniversityIndexStore

    var body: some View {
        switch failure {
        case .connection:
            AtlasMessageView(title: "catalog_load_failed", message: "catalog_load_failed_hint", systemImage: "wifi.exclamationmark") {
                await store.refresh()
            }
        case .unavailable:
            AtlasMessageView(title: "catalog_load_failed", message: "catalog_load_failed_unavailable_hint", systemImage: "building.columns") {
                await store.refresh()
            }
        }
    }
}

/// Скелет экрана страны или города, пока индекс грузится.
struct AtlasPlaceSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                RoundedRectangle(cornerRadius: AtlasStyle.cardRadius, style: .continuous)
                    .fill(AtlasStyle.placeholder)
                    .aspectRatio(3 / 2, contentMode: .fit)
                ForEach([0, 24, 96], id: \.self) { inset in
                    RoundedRectangle(cornerRadius: 4)
                        .fill(AtlasStyle.placeholder)
                        .frame(height: 14)
                        .padding(.trailing, CGFloat(inset))
                }
                RoundedRectangle(cornerRadius: AtlasStyle.cardRadius, style: .continuous)
                    .fill(AtlasStyle.placeholder)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .padding(.top, 8)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .scrollDisabled(true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("catalog_loading"))
    }
}

/// Плашка «показана сохранённая версия»: копия есть, сверка не удалась.
struct AtlasStaleNotice: View {
    var body: some View {
        Label {
            Text("catalog_refresh_failed")
        } icon: {
            Image(systemName: "arrow.clockwise.circle")
                .accessibilityHidden(true)
        }
        .font(.footnote)
        .foregroundStyle(AtlasStyle.secondaryText)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(AtlasStyle.surface, in: RoundedRectangle(cornerRadius: AtlasStyle.elementRadius, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Фото кампуса на странице вуза: перенесённая копия нужного размера (затем
/// оригинал того же объекта), атрибуция по «©». Копии нет: прежняя честная
/// заглушка «Проверенное фото кампуса пока не добавлено» без кнопки «©», как
/// `PhotoFigure` веба.
struct UniversityDetailPhoto: View {
    let photoKey: String?
    let universityName: String

    var body: some View {
        if let credit = AtlasPhotoCredit(universityPhotoKey: photoKey, universityName: universityName) {
            let caption = credit.caption?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            // Без подписи фото для VoiceOver оформление: пустая метка
            // давала фокус на изображении без описания.
            AtlasPhotoView(subject: .university(photoKey: photoKey), aspectRatio: 16 / 9, cornerRadius: 14)
                .accessibilityElement()
                .accessibilityLabel(Text(caption))
                .accessibilityAddTraits(.isImage)
                .accessibilityHidden(caption.isEmpty)
                .overlay(alignment: .bottomTrailing) {
                    AtlasPhotoCreditButton(credit: credit)
                        .padding(6)
                }
        } else {
            UniversityPhotoView(photoKey: nil)
        }
    }
}
