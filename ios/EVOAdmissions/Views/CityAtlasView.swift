import SwiftUI

/// Город (план 7.3, 7.4): шапка с фото и текстом, самый интересный факт со
/// ссылкой на источник и датой проверки, карточки вузов города.
struct CityAtlasView: View {
    let cityKey: String

    @ObservedObject private var store = UniversityIndexStore.shared
    @ObservedObject private var favorites = FavoritesStore.shared

    var body: some View {
        Group {
            // Те же три состояния без индекса, что у экрана страны.
            switch UniversityAtlasPolicy.cityState(key: cityKey, index: store.index, phase: store.phase) {
            case .ready(let index, let city):
                content(city, index: index)
                    .navigationTitle(city.name.text(kyrgyz: AtlasText.kyrgyz))
            case .loading:
                AtlasPlaceSkeleton()
            case .failed(let failure):
                AtlasIndexFailureView(failure: failure, store: store)
            case .missing:
                AtlasMessageView(title: "catalog_city_missing", systemImage: "building.2")
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }

    private func content(_ city: AtlasCity, index: UniversityIndex) -> some View {
        let universities = UniversityAtlasPolicy.universities(inCity: city.key, in: index)
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if store.refreshFailed { AtlasStaleNotice() }
                AtlasHeaderPhoto(photo: city.photo, subject: city.name.text(kyrgyz: AtlasText.kyrgyz))
                AtlasParagraph(text: city.summary.text(kyrgyz: AtlasText.kyrgyz))
                CityFactView(fact: city.fact)

                Text("catalog_city_universities")
                    .font(.title3.bold())
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 4)
                ForEach(universities) { university in
                    UniversityAtlasCard(university: university, favorites: favorites)
                        .motionStagger(
                            index: MotionPolicy.staggerIndex(of: university, in: universities),
                            key: "atlas.university.\(university.id)"
                        )
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .refreshable { await store.refresh() }
    }
}

/// Факт города: текст, источник ссылкой и дата проверки.
private struct CityFactView: View {
    let fact: AtlasCityFact

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "lightbulb")
                .font(.title3)
                .foregroundStyle(AtlasStyle.secondaryText)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                // Подпись видна, как на вебе («Интересный факт»).
                Text("catalog_city_fact_label")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AtlasStyle.secondaryText)
                    .accessibilityHidden(true)
                Text(fact.text.text(kyrgyz: AtlasText.kyrgyz))
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(Text(String(
                        format: String(localized: "catalog_city_fact_a11y"),
                        fact.text.text(kyrgyz: AtlasText.kyrgyz)
                    )))
                Link(destination: fact.sourceUrl) {
                    HStack(spacing: 6) {
                        Text(String(format: String(localized: "catalog_fact_source"), AtlasText.day(fact.verifiedOn)))
                            .multilineTextAlignment(.leading)
                        Image(systemName: "arrow.up.right")
                            .imageScale(.small)
                            .accessibilityHidden(true)
                    }
                    .font(.subheadline)
                    .foregroundStyle(AtlasStyle.linkText)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AtlasStyle.surface, in: RoundedRectangle(cornerRadius: AtlasStyle.elementRadius, style: .continuous))
    }
}
