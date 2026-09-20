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
