import MapKit
import SwiftUI

/// «Карта» на экране страны (план 7.3, 7.4): MapKit, вузы страны с
/// проверенной координатой гео-библиотеки, близкие точки собираются в одну
/// метку с числом (`UniversityMapPolicy.clusters`, сборка 1.0, PR #1172).
/// Вуз без координаты на карту не попадает и виден в счётчике «без точки».
/// Данные из индекса: карте не нужны страницы каталога.
struct CountryAtlasMap: View {
    let universities: [UniversityIndexEntry]
    let index: UniversityIndex

    private var selection: (pins: [UniversityMapPin], missing: Int) {
        UniversityAtlasPolicy.mapPins(for: universities, geo: UniversityGeoLibrary.shared) { university in
            UniversityAtlasPolicy.cityName(for: university, in: index, kyrgyz: AtlasText.kyrgyz)
        }
    }

    var body: some View {
        let selection = selection
        if universities.isEmpty {
            AtlasMessageView(title: "catalog_country_no_universities", systemImage: "map")
        } else {
            CountryAtlasMapCanvas(pins: selection.pins, missing: selection.missing)
        }
    }
}

private struct CountryAtlasMapCanvas: View {
    let pins: [UniversityMapPin]
    let missing: Int

    /// `.automatic` вписывает все метки в кадр.
    @State private var position: MapCameraPosition = .automatic
    @State private var selected: UniversityMapPin?
    @State private var selectedCluster: UniversityMapCluster?
    @State private var visibleRegion: MKCoordinateRegion?
    @State private var mapSize: CGSize = .zero

    private static let brand = Color(red: 215 / 255, green: 2 / 255, blue: 23 / 255)

    private var clusters: [UniversityMapCluster] {
        let cell = visibleRegion.flatMap {
            UniversityMapPolicy.clusterCell(
                latitudeDelta: $0.span.latitudeDelta,
                longitudeDelta: $0.span.longitudeDelta,
                mapWidth: mapSize.width,
                mapHeight: mapSize.height
            )
        }
        return UniversityMapPolicy.clusters(pins, cell: cell)
    }

    var body: some View {
        // Карточки в нижней вставке безопасной области, а не поверх карты:
        // MapKit поднимает логотип Apple Maps и «Правовые документы» над
        // ними, обязательная атрибуция не закрыта.
        Map(position: $position) {
            ForEach(clusters) { cluster in
                if let pin = cluster.single {
                    Annotation(pin.name, coordinate: CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng)) {
                        Button {
                            selectedCluster = nil
                            selected = pin
                        } label: {
                            Circle()
                                .fill(Self.brand)
                                .frame(width: 16, height: 16)
                                .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                                .frame(width: 44, height: 44)
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(pin.name))
                    }
                } else {
                    Annotation(String(), coordinate: CLLocationCoordinate2D(latitude: cluster.lat, longitude: cluster.lng)) {
                        Button {
                            selected = nil
                            selectedCluster = cluster
                        } label: {
                            Text(verbatim: "\(cluster.pins.count)")
                                .font(.footnote.weight(.bold))
                                .monospacedDigit()
                                .foregroundStyle(.white)
                                .padding(6)
                                .frame(minWidth: 30, minHeight: 30)
                                .background(Circle().fill(Self.brand))
                                .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                                .frame(minWidth: 44, minHeight: 44)
                                .contentShape(Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(clusterTitle(cluster)))
                        .accessibilityHint(Text("catalog_map_cluster_hint"))
                    }
                }
            }
        }
        // Метки на карте не растут бесконечно с Dynamic Type: при крупных
        // размерах они закрывали бы друг друга; сводка и карточки растут.
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .onMapCameraChange(frequency: .onEnd) { context in
            visibleRegion = context.region
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { mapSize = $0 }
        .accessibilityLabel(Text("universities_map_label"))
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let selected {
                pinCard(selected)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            } else if let selectedCluster {
                clusterCard(selectedCluster)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }
        }
        // Сводка сверху: внизу слева обязательная атрибуция Apple Maps.
        .overlay(alignment: .top) {
            summary
                .padding(.horizontal, 16)
                .padding(.top, 8)
        }
        .onChange(of: pins) {
            selected = nil
            selectedCluster = nil
            position = .automatic
        }
    }

    private func clusterTitle(_ cluster: UniversityMapCluster) -> String {
        String(format: String(localized: "catalog_map_cluster_title"), locale: AppLocale.current, cluster.pins.count)
    }

    /// «На карте: N · Без точки на карте: M» на плотной подложке.
    private var summary: some View {
        let shown = String(format: String(localized: "universities_map_shown"), locale: AppLocale.current, pins.count)
        let withoutPoint = missing > 0
            ? " · " + String(format: String(localized: "catalog_map_without_point"), locale: AppLocale.current, missing)
            : ""
        return Text(verbatim: shown + withoutPoint)
            .font(.footnote)
            .foregroundStyle(.primary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: AtlasStyle.elementRadius))
            .overlay(RoundedRectangle(cornerRadius: AtlasStyle.elementRadius).strokeBorder(Color(.separator), lineWidth: 0.5))
    }

    private func pinCard(_ pin: UniversityMapPin) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(pin.name)
                .font(.headline)
            if let city = pin.city {
                Text(city)
                    .font(.subheadline)
                    .foregroundStyle(AtlasStyle.secondaryText)
            }
            HStack {
                AtlasLink(route: .university(pin.id)) {
                    Text("universities_map_open_card")
                        .frame(minHeight: 30)
                }
                .buttonStyle(.borderedProminent)
                .tint(Self.brand)
                Spacer()
                Button("universities_map_close_card") { selected = nil }
                    .buttonStyle(.bordered)
                    .tint(AtlasStyle.linkText)
            }
            .frame(minHeight: 44)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: AtlasStyle.cardRadius))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    }

    /// Метка с несколькими вузами: каждый открывается отдельно, в том числе
    /// вузы с одинаковой координатой.
    private func clusterCard(_ cluster: UniversityMapCluster) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(clusterTitle(cluster))
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button("universities_map_close_card") { selectedCluster = nil }
                    .buttonStyle(.bordered)
                    .tint(AtlasStyle.linkText)
                    .frame(minHeight: 44)
            }
            // Короткий список без прокрутки; длинный прокручивается в 240 pt.
            if cluster.pins.count <= 3 {
                clusterList(cluster)
            } else {
                ScrollView { clusterList(cluster) }
                    .frame(maxHeight: 240)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: AtlasStyle.cardRadius))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    }

    private func clusterList(_ cluster: UniversityMapCluster) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(cluster.pins) { pin in
                AtlasLink(route: .university(pin.id)) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pin.name)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.primary)
                                .multilineTextAlignment(.leading)
                            if let city = pin.city {
                                Text(city)
                                    .font(.footnote)
                                    .foregroundStyle(AtlasStyle.secondaryText)
                            }
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(AtlasStyle.secondaryText)
                            .accessibilityHidden(true)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if pin.id != cluster.pins.last?.id { Divider() }
            }
        }
    }
}
