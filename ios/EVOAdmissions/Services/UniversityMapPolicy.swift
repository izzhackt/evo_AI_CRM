import Foundation

/// Пин карты: только вуз с проверенной координатой из репо-гео-библиотеки.
/// «Город · страна» форматирует вью (локаль знает UI-слой) — политика несёт
/// сырые факты карточки.
struct UniversityMapPin: Identifiable, Equatable {
    let id: UUID
    let name: String
    let country: String
    let city: String?
    let lat: Double
    let lng: Double
}

enum UniversityMapPolicy {
    /// Зеркало исключений веб-`readStudentUniversitiesComplete`
    /// (src/lib/portal/university-catalog-reader.ts:36-39): и не движущийся
    /// вперёд offset, и перерастание потолка — явная ошибка карты, а не
    /// частичный результат; список остаётся полноценным (план §6).
    enum CollectError: Error, Equatable {
        case nonAdvancingOffset
        case pageLimitExceeded
    }

    /// 12 страниц × 30 записей — тот же честный предохранитель, что у веба
    /// (university-catalog-reader.ts:26).
    static let pageLimit = 12

    /// Полный отфильтрованный набор для карты: карта показывает все
    /// подходящие записи, а не одну страницу списка — иначе точки зависели
    /// бы от пагинации (university-catalog-reader.ts:19-40). Дубликаты
    /// между страницами (публикация сдвинула offset) отбрасываются.
    static func collectComplete(
        fetchPage: (Int) async throws -> UniversityCatalogPage
    ) async throws -> [UniversityCatalogItem] {
        var items: [UniversityCatalogItem] = []
        var seen = Set<UUID>()
        var offset = 0
        for _ in 0..<pageLimit {
            let page = try await fetchPage(offset)
            for item in page.items where !seen.contains(item.id) {
                seen.insert(item.id)
                items.append(item)
            }
            guard let next = page.nextOffset else { return items }
            if next <= offset { throw CollectError.nonAdvancingOffset }
            offset = next
        }
        throw CollectError.pageLimitExceeded
    }

    /// Пины текущего набора: вуз без записи в гео-библиотеке честно
    /// считается в `missing` и на карту не попадает — никаких выдуманных
    /// координат (план §6 «Карта»; тот же отбор, что у веб-страницы,
    /// src/app/(portal)/portal/universities/page.tsx:64-78).
    static func pins(
        for items: [UniversityCatalogItem],
        geo: [String: UniversityGeoEntry]
    ) -> (pins: [UniversityMapPin], missing: Int) {
        var pins: [UniversityMapPin] = []
        var missing = 0
        for item in items {
            guard let key = item.content.photoKey, let entry = geo[key] else {
                missing += 1
                continue
            }
            pins.append(UniversityMapPin(
                id: item.id,
                name: item.content.name,
                country: item.content.country,
                city: item.content.city,
                lat: entry.lat,
                lng: entry.lng
            ))
        }
        return (pins, missing)
    }
}

/// Метка карты: один вуз или несколько близких вузов под одной меткой с
/// числом. Раньше каждый вуз рисовался отдельной точкой 16 pt, и 11 вузов
/// Шанхая и окрестностей ложились в квадрат 24 на 23 pt: открыть удавалось
/// только верхнюю точку стопки (аудит UX/UI 2026-10).
struct UniversityMapCluster: Identifiable, Equatable {
    let pins: [UniversityMapPin]
    let lat: Double
    let lng: Double

    var id: String { pins.map(\.id.uuidString).joined(separator: "+") }
    var single: UniversityMapPin? { pins.count == 1 ? pins.first : nil }
}

extension UniversityMapPolicy {
    /// Размер метки на экране, ближе которого точки собираются в одну.
    static let clusterTargetPoints = 44.0

    /// Сколько градусов занимает `clusterTargetPoints` на карте видимого
    /// размера: делитель берётся из размера карты в точках.
    static func clusterCell(
        latitudeDelta: Double,
        longitudeDelta: Double,
        mapWidth: Double,
        mapHeight: Double
    ) -> (lat: Double, lng: Double)? {
        guard latitudeDelta.isFinite, longitudeDelta.isFinite, latitudeDelta > 0, longitudeDelta > 0,
              mapWidth > 0, mapHeight > 0 else { return nil }
        return (latitudeDelta * clusterTargetPoints / mapHeight,
                longitudeDelta * clusterTargetPoints / mapWidth)
    }

    /// Жадная группировка: точка попадает в первую метку, центр которой ближе
    /// размера ячейки по широте и долготе; центр метки пересчитывается как
    /// среднее. Порядок входа сохраняется, вузы внутри метки по названию.
    /// Без размера ячейки (карта ещё не измерена) каждая точка остаётся своей.
    static func clusters(
        _ pins: [UniversityMapPin],
        cell: (lat: Double, lng: Double)?
    ) -> [UniversityMapCluster] {
        guard let cell, cell.lat > 0, cell.lng > 0 else {
            return pins.map { UniversityMapCluster(pins: [$0], lat: $0.lat, lng: $0.lng) }
        }
        var groups: [(pins: [UniversityMapPin], lat: Double, lng: Double)] = []
        for pin in pins {
            if let index = groups.firstIndex(where: {
                abs($0.lat - pin.lat) < cell.lat && abs($0.lng - pin.lng) < cell.lng
            }) {
                var group = groups[index]
                group.pins.append(pin)
                let count = Double(group.pins.count)
                group.lat += (pin.lat - group.lat) / count
                group.lng += (pin.lng - group.lng) / count
                groups[index] = group
            } else {
                groups.append(([pin], pin.lat, pin.lng))
            }
        }
        return groups.map { group in
            UniversityMapCluster(
                pins: group.pins.sorted {
                    $0.name.localizedStandardCompare($1.name) == .orderedAscending
                },
                lat: group.lat,
                lng: group.lng
            )
        }
    }
}
