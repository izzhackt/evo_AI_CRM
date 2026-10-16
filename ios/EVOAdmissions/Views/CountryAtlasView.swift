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
            if let index = store.index, let country = index.countries.first(where: { $0.code == code }) {
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
            } else {
                AtlasMessageView(title: "catalog_country_missing", systemImage: "globe")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func cities(_ country: AtlasCountry, index: UniversityIndex) -> some View {
        let cities = UniversityAtlasPolicy.cities(of: code, in: index)
        let others = UniversityAtlasPolicy.otherUniversities(of: code, in: index)
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if store.refreshFailed { AtlasStaleNotice() }
                AtlasHeaderPhoto(photo: country.photo)
                if let summary = country.summary {
                    AtlasParagraph(text: summary.text(kyrgyz: AtlasText.kyrgyz))
                }
                if country.universityCount == 0 {
                    Text("catalog_country_no_universities")
                        .font(.body)
                        .foregroundStyle(AtlasStyle.secondaryText)
                }
                ForEach(cities) { city in
                    NavigationLink(value: AtlasRoute.city(city.key)) {
                        CityAtlasCard(city: city)
                    }
                    .buttonStyle(.pressable)
                    .motionStagger(index: MotionPolicy.staggerIndex(of: city, in: cities), key: "atlas.city.\(city.key)")
                }
                if !others.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("catalog_other_universities")
                            .font(.title3.bold())
                            .accessibilityAddTraits(.isHeader)
                            .padding(.top, cities.isEmpty ? 0 : 8)
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

/// Карточка города: фото, название, число вузов, короткий текст.
private struct CityAtlasCard: View {
    let city: AtlasCity

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            AtlasPhotoView(subject: .geography(city.photo), aspectRatio: 16 / 9)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        name
                        Spacer(minLength: 8)
                        count
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        name
                        count
                    }
                }
                Text(city.summary.text(kyrgyz: AtlasText.kyrgyz))
                    .font(.subheadline)
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var name: some View {
        Text(city.name.text(kyrgyz: AtlasText.kyrgyz))
            .font(.title3.weight(.semibold))
            .foregroundStyle(.primary)
    }

    private var count: some View {
        Text(AtlasText.universities(city.universityCount ?? 0))
            .font(.subheadline)
            .foregroundStyle(AtlasStyle.secondaryText)
    }
}
