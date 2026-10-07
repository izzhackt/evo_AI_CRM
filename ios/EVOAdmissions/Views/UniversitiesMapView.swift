import MapKit
import SwiftUI

/// Карта каталога (волна 9b): MapKit / SwiftUI `Map` (iOS 17) — системная
/// подложка Apple без третьей стороны; юридическая атрибуция Apple Maps
/// рисуется самим компонентом. Пины — ТОЛЬКО вузы с проверенной координатой
/// из репо-гео-библиотеки (`UniversityGeoLibrary`); вуз без координаты
/// честно отсутствует и виден в счётчике «без точки» (план §6 «Карта»).
/// Решение и компромисс против MapLibre Native — docs/PLAN_CHANGES.md 9b.
struct UniversitiesMapContainer: View {
    @ObservedObject var model: UniversitiesViewModel

    var body: some View {
        Group {
            if model.isMapLoading && model.mapPins.isEmpty && !model.mapFailed {
                VStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
            } else if model.mapFailed {
                // Сбой карты показывается явно; список не маскирует её
                // неисправность (план §6) — та же позиция, что веб mapFailed.
                VStack(spacing: 12) {
                    Spacer()
                    Text("universities_map_failed")
                        .font(.body)
                        .multilineTextAlignment(.center)
                    Button("retry_button") {
                        Task { await model.loadMap() }
                    }
                    .accentBordered()
                    Button("universities_view_list") {
                        model.viewMode = .list
                    }
                    Spacer()
                }
                .padding(32)
            } else {
                UniversitiesMapCanvas(
                    pins: model.mapPins,
                    missing: model.mapMissing
                )
            }
        }
        .task(id: model.viewMode) {
            if model.viewMode == .map {
                await model.loadMapIfNeeded()
            }
        }
    }
}

private struct UniversitiesMapCanvas: View {
    let pins: [UniversityMapPin]
    let missing: Int

    /// `.automatic` вписывает все аннотации в кадр — аналог fitBounds веба.
    @State private var position: MapCameraPosition = .automatic
    @State private var selected: UniversityMapPin?
    @State private var selectedCluster: UniversityMapCluster?
    /// Видимая область и размер карты: из них считается, какие точки ближе
    /// 44 pt и собираются в одну метку.
    @State private var visibleRegion: MKCoordinateRegion?
    @State private var mapSize: CGSize = .zero

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
        ZStack(alignment: .bottom) {
            Map(position: $position) {
                ForEach(clusters) { cluster in
                    if let pin = cluster.single {
                        Annotation(
                            pin.name,
                            coordinate: CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng)
                        ) {
                            Button {
                                selectedCluster = nil
                                selected = pin
                            } label: {
                                Circle()
                                    // Брендовый красный #d70217 (дизайн-контракт).
                                    .fill(Color(red: 215 / 255, green: 2 / 255, blue: 23 / 255))
                                    .frame(width: 16, height: 16)
                                    .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                                    // Зона нажатия 44 pt при точке 16 pt.
                                    .frame(width: 44, height: 44)
                                    .contentShape(Circle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(pin.name))
                        }
                    } else {
                        // Без подписи под меткой: число вузов уже на самой метке.
                        Annotation(
                            String(),
                            coordinate: CLLocationCoordinate2D(latitude: cluster.lat, longitude: cluster.lng)
                        ) {
                            Button {
                                selected = nil
                                selectedCluster = cluster
                            } label: {
                                Text(verbatim: "\(cluster.pins.count)")
                                    .font(.footnote.weight(.bold))
                                    .monospacedDigit()
                                    .foregroundStyle(.white)
                                    .frame(minWidth: 30, minHeight: 30)
                                    .background(Circle().fill(Color(red: 215 / 255, green: 2 / 255, blue: 23 / 255)))
                                    .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                                    .frame(minWidth: 44, minHeight: 44)
                                    .contentShape(Circle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(String(
                                format: String(localized: "universities_map_cluster_title"),
                                locale: AppLocale.current,
                                cluster.pins.count
                            )))
                            .accessibilityHint(Text("universities_map_cluster_hint"))
                        }
                    }
                }
            }
            .onMapCameraChange(frequency: .onEnd) { context in
                visibleRegion = context.region
            }
            .onGeometryChange(for: CGSize.self) { $0.size } action: { mapSize = $0 }
            .accessibilityLabel(Text("universities_map_label"))

            VStack(spacing: 8) {
                if let selected {
                    pinCard(selected)
                } else if let selectedCluster {
                    clusterCard(selectedCluster)
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
        // Сводка сверху: внизу слева карта показывает обязательную
        // атрибуцию Apple Maps, её нельзя закрывать.
        .overlay(alignment: .top) {
            summary
                .padding(.horizontal)
                .padding(.top, 8)
        }
        .onChange(of: pins) {
            selected = nil
            selectedCluster = nil
            position = .automatic
        }
    }

    /// Честная сводка веба (UniversitiesMapSummary): сколько точек показано
    /// и сколько вузов текущего набора без проверенной координаты. Плотная
    /// подложка и основной цвет текста: на материале над океаном сводка
    /// давала 2,3..2,5:1 (аудит UX/UI 2026-10).
    private var summary: some View {
        let shown = String(
            format: String(localized: "universities_map_shown"),
            locale: AppLocale.current,
            pins.count
        )
        let withoutPoint = missing > 0
            ? " · " + String(
                format: String(localized: "universities_map_without_point"),
                locale: AppLocale.current,
                missing
            )
            : ""
        return Text(verbatim: shown + withoutPoint)
            .font(.footnote)
            .foregroundStyle(.primary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color(.separator), lineWidth: 0.5))
    }

    /// Мини-карточка выбранного пина — переход на существующую карточку
    /// вуза (`UniversityDetailView` через navigationDestination каталога).
    private func pinCard(_ pin: UniversityMapPin) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(pin.name)
                .font(.headline)
            Text(pinPlaceLine(pin))
                .font(.subheadline)
                .foregroundStyle(.secondaryText)
            HStack {
                NavigationLink(value: pin.id) {
                    Text("universities_map_open_card")
                }
                .accentProminent()
                Spacer()
                Button("universities_map_close_card") {
                    selected = nil
                }
                .accentBordered()
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    }

    /// Карточка метки с несколькими вузами: каждый вуз открывается отдельно,
    /// в том числе вузы с одинаковой координатой.
    private func clusterCard(_ cluster: UniversityMapCluster) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(String(
                    format: String(localized: "universities_map_cluster_title"),
                    locale: AppLocale.current,
                    cluster.pins.count
                ))
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                Spacer()
                Button("universities_map_close_card") {
                    selectedCluster = nil
                }
                .accentBordered()
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(cluster.pins) { pin in
                        NavigationLink(value: pin.id) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(pin.name)
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(.primary)
                                        .multilineTextAlignment(.leading)
                                    Text(pinPlaceLine(pin))
                                        .font(.footnote)
                                        .foregroundStyle(.secondaryText)
                                }
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.right")
                                    .font(.footnote.weight(.semibold))
                                    .foregroundStyle(.secondaryText)
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if pin.id != cluster.pins.last?.id { Divider() }
                    }
                }
            }
            .frame(maxHeight: 240)
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 2)
    }

    private func pinPlaceLine(_ pin: UniversityMapPin) -> String {
        let country = AppLocale.current.localizedString(forRegionCode: pin.country)
            ?? pin.country
        if let city = pin.city, !city.isEmpty {
            // Разделитель « · » — как у мини-карточки веб-карты
            // (src/app/(portal)/portal/universities/page.tsx:74).
            return "\(city) · \(country)"
        }
        return country
    }
}
