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
                    .buttonStyle(.bordered)
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

    var body: some View {
        ZStack(alignment: .bottom) {
            Map(position: $position) {
                ForEach(pins) { pin in
                    Annotation(
                        pin.name,
                        coordinate: CLLocationCoordinate2D(latitude: pin.lat, longitude: pin.lng)
                    ) {
                        Button {
                            selected = pin
                        } label: {
                            Circle()
                                // Брендовый красный #d70217 (дизайн-контракт).
                                .fill(Color(red: 215 / 255, green: 2 / 255, blue: 23 / 255))
                                .frame(width: 16, height: 16)
                                .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                        }
                        .accessibilityLabel(Text(pin.name))
                    }
                }
            }
            .accessibilityLabel(Text("universities_map_label"))

            VStack(spacing: 8) {
                if let selected {
                    pinCard(selected)
                }
                summary
            }
            .padding(.horizontal)
            .padding(.bottom, 8)
        }
        .onChange(of: pins) {
            selected = nil
            position = .automatic
        }
    }

    /// Честная сводка веба (UniversitiesMapSummary): сколько точек показано
    /// и сколько вузов текущего набора без проверенной координаты.
    private var summary: some View {
        HStack(spacing: 4) {
            Text(String(
                format: String(localized: "universities_map_shown"),
                locale: AppLocale.current,
                pins.count
            ))
            if missing > 0 {
                Text(verbatim: "·")
                Text(String(
                    format: String(localized: "universities_map_without_point"),
                    locale: AppLocale.current,
                    missing
                ))
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.thinMaterial, in: Capsule())
        .accessibilityElement(children: .combine)
    }

    /// Мини-карточка выбранного пина — переход на существующую карточку
    /// вуза (`UniversityDetailView` через navigationDestination каталога).
    private func pinCard(_ pin: UniversityMapPin) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(pin.name)
                .font(.headline)
            Text(pinPlaceLine(pin))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            HStack {
                NavigationLink(value: pin.id) {
                    Text("universities_map_open_card")
                }
                .buttonStyle(.borderedProminent)
                Spacer()
                Button("universities_map_close_card") {
                    selected = nil
                }
                .buttonStyle(.bordered)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
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
