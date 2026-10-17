import SwiftUI

/// Страна (план 7.3, 7.4): переключатель «Города / Карта»; города в порядке
/// выдачи (больше вузов, затем название), вузы без опубликованного города в
/// «Других вузах страны»; карта MapKit с метками-кластерами сборки 1.0.
struct CountryAtlasView: View {
    let code: String

    enum Mode: Hashable { case cities, map }

    @ObservedObject private var store = UniversityIndexStore.shared
    @ObservedObject private var favorites = FavoritesStore.shared
    @State private var mode: Mode = .cities

    var body: some View {
        Group {
            // Экран открывают и со страницы вуза на «Главной» или в
            // «Профессиях», когда вкладку «Университеты» ещё не открывали:
            // индекс грузит `TabShell` на старте сессии, а пока его нет,
            // экран различает загрузку, сбой (с повтором) и «страны нет».
            switch UniversityAtlasPolicy.countryState(code: code, index: store.index, phase: store.phase) {
            case .ready(let index, let country):
                VStack(spacing: 0) {
                    Picker("universities_view_toggle", selection: $mode) {
                        Text("catalog_view_cities").tag(Mode.cities)
                        Text("universities_view_map").tag(Mode.map)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)

                    switch mode {
                    case .cities:
                        cities(country, index: index)
                    case .map:
                        CountryAtlasMap(
                            universities: UniversityAtlasPolicy.universities(of: code, in: index),
                            index: index
                        )
                    }
                }
                .navigationTitle(country.name.text(kyrgyz: AtlasText.kyrgyz))
            case .loading:
                AtlasPlaceSkeleton()
            case .failed(let failure):
                AtlasIndexFailureView(failure: failure, store: store)
            case .missing:
                AtlasMessageView(title: "catalog_country_missing", systemImage: "globe")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func cities(_ country: AtlasCountry, index: UniversityIndex) -> some View {
        let cities = UniversityAtlasPolicy.cities(of: code, in: index, kyrgyz: AtlasText.kyrgyz)
        let others = UniversityAtlasPolicy.otherUniversities(of: code, in: index)
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if store.refreshFailed { AtlasStaleNotice() }
                AtlasHeaderPhoto(photo: country.photo, subject: country.name.text(kyrgyz: AtlasText.kyrgyz))
                if let summary = country.summary {
                    AtlasParagraph(text: summary.text(kyrgyz: AtlasText.kyrgyz))
                }
                if country.universityCount == 0 {
                    Text("catalog_country_no_universities")
                        .font(.body)
                        .foregroundStyle(AtlasStyle.secondaryText)
                }
                ForEach(cities) { city in
                    AtlasLink(route: .city(city.key)) {
                        CityAtlasCard(city: city)
                    }
                    .buttonStyle(.pressable)
                    // «©» на фото карточки города, как в шапке и на вебе.
                    .overlay(alignment: .topTrailing) {
                        AtlasPhotoCreditButton(credit: AtlasPhotoCredit(place: city.photo, subject: city.name.text(kyrgyz: AtlasText.kyrgyz)))
                            .padding(6)
                    }
                    .motionStagger(index: MotionPolicy.staggerIndex(of: city, in: cities), key: "atlas.city.\(city.key)")
                }
                if !others.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("catalog_other_universities")
                            .font(.title3.bold())
                            .accessibilityAddTraits(.isHeader)
                            .padding(.top, cities.isEmpty ? 0 : 8)
                        Text("catalog_other_universities_lead")
                            .font(.subheadline)
                            .foregroundStyle(AtlasStyle.secondaryText)
                            .fixedSize(horizontal: false, vertical: true)
                        ForEach(others) { university in
                            UniversityIndexRow(
                                university: university,
                                place: UniversityAtlasPolicy.cityName(for: university, in: index, kyrgyz: AtlasText.kyrgyz),
                                favorites: favorites
                            )
                            if university.id != others.last?.id { Divider().padding(.leading, 76) }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
        .refreshable { await store.refresh() }
    }
}

/// Карточка города (решение Р2, план 7.3, как `CityCards` веба): фото,
/// название, число вузов, короткий текст целиком и самый интересный факт с
/// подписью «Интересный факт». Абзацы рисует `AtlasParagraph`: SwiftUI
/// `Text` на iOS 26 обрезал длинный русский абзац многоточием.
private struct CityAtlasCard: View {
    let city: AtlasCity

    private var name: String { city.name.text(kyrgyz: AtlasText.kyrgyz) }
    private var count: String { AtlasText.universities(city.universityCount ?? 0) }
    private var summary: String { city.summary.text(kyrgyz: AtlasText.kyrgyz) }
    private var fact: String { city.fact.text.text(kyrgyz: AtlasText.kyrgyz) }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            AtlasPhotoView(subject: .geography(city.photo), aspectRatio: 16 / 9)
            VStack(alignment: .leading, spacing: 8) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        nameText
                        Spacer(minLength: 8)
                        countText
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        nameText
                        countText
                    }
                }
                AtlasParagraph(text: summary, style: .subheadline)
                VStack(alignment: .leading, spacing: 4) {
                    Text("catalog_city_fact_label")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(AtlasStyle.secondaryText)
                    AtlasParagraph(text: fact, style: .subheadline)
                }
                .padding(.leading, 12)
                .overlay(alignment: .leading) {
                    Capsule()
                        .fill(AtlasStyle.secondaryText.opacity(0.35))
                        .frame(width: 3)
                }
                .padding(.top, 2)
            }
            .padding(.horizontal, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        // Абзацы на `UILabel` VoiceOver не собирает в одну кнопку сам:
        // подпись карточки собрана явно, название первым.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(name), \(count). \(summary) "
            + String(format: String(localized: "catalog_city_fact_a11y"), fact)))
    }

    private var nameText: some View {
        Text(name)
            .font(.title3.weight(.semibold))
            .foregroundStyle(.primary)
    }

    private var countText: some View {
        Text(count)
            .font(.subheadline)
            .foregroundStyle(AtlasStyle.secondaryText)
    }
}
