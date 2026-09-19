import XCTest

/// Политика карты: полный отфильтрованный набор (зеркало
/// `readStudentUniversitiesComplete`, src/lib/portal/university-catalog-reader.ts:19-40)
/// и честный отбор пинов — вуз без проверенной координаты на карту не
/// попадает и считается в `missing` (план §6 «Карта»).
final class UniversityMapPolicyTests: XCTestCase {

    private func item(
        id: UUID = UUID(),
        name: String = "Test University",
        country: String = "MY",
        city: String? = "Kuala Lumpur",
        photoKey: String?
    ) -> UniversityCatalogItem {
        UniversityCatalogItem(
            id: id,
            version: 1,
            publishedAt: "2026-09-19T00:00:00+00:00",
            content: UniversityContent(
                name: name,
                country: country,
                city: city,
                overview: "overview",
                websiteUrl: "https://example.edu",
                sourceUrl: "https://example.edu/admissions",
                verifiedOn: "2026-09-19",
                notes: "",
                photoKey: photoKey,
                programs: []
            )
        )
    }

    private func page(_ items: [UniversityCatalogItem], next: Int?) -> UniversityCatalogPage {
        UniversityCatalogPage(items: items, nextOffset: next)
    }

    // MARK: - collectComplete

    func testCollectsAllPagesAndStopsAtNilNextOffset() async throws {
        let a = item(photoKey: "a"), b = item(photoKey: "b"), c = item(photoKey: nil)
        let pages = [page([a, b], next: 30), page([c], next: nil)]
        var requestedOffsets: [Int] = []
        let items = try await UniversityMapPolicy.collectComplete { offset in
            requestedOffsets.append(offset)
            return pages[offset == 0 ? 0 : 1]
        }
        XCTAssertEqual(items.map(\.id), [a.id, b.id, c.id])
        XCTAssertEqual(requestedOffsets, [0, 30])
    }

    func testDeduplicatesRepeatedRowAcrossPages() async throws {
        // Публикация между страницами может сдвинуть offset и повторить
        // запись — карта берёт первую версию (reader:29-33).
        let a = item(photoKey: "a"), b = item(photoKey: "b")
        let pages = [page([a, b], next: 30), page([b], next: nil)]
        let items = try await UniversityMapPolicy.collectComplete { offset in
            pages[offset == 0 ? 0 : 1]
        }
        XCTAssertEqual(items.map(\.id), [a.id, b.id])
    }

    func testNonAdvancingOffsetIsAnError() async {
        // reader:36 — `nextOffset <= offset` → «Catalogue unavailable».
        let a = item(photoKey: "a")
        do {
            _ = try await UniversityMapPolicy.collectComplete { _ in
                self.page([a], next: 0)
            }
            XCTFail("expected nonAdvancingOffset")
        } catch let error as UniversityMapPolicy.CollectError {
            XCTAssertEqual(error, .nonAdvancingOffset)
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testThirteenthPageIsAnError() async {
        // reader:26/39 — потолок 12 страниц; перерастание — явная ошибка
        // карты, а не частичный результат.
        do {
            _ = try await UniversityMapPolicy.collectComplete { offset in
                self.page([self.item(photoKey: nil)], next: offset + 30)
            }
            XCTFail("expected pageLimitExceeded")
        } catch let error as UniversityMapPolicy.CollectError {
            XCTAssertEqual(error, .pageLimitExceeded)
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    // MARK: - Отбор пинов

    func testPinSelectionUsesOnlyVerifiedCoordinates() throws {
        let geo: [String: UniversityGeoEntry] = [
            "sunway": UniversityGeoEntry(
                lat: 3.067,
                lng: 101.603,
                sourceUrl: "https://www.wikidata.org/wiki/Q7639753",
                verifiedOn: "2026-09-19"
            ),
        ]
        let withPin = item(name: "Sunway University", photoKey: "sunway")
        let unknownKey = item(name: "No Geo University", photoKey: "no-such-key")
        let noKey = item(name: "No Photo University", photoKey: nil)

        let selection = UniversityMapPolicy.pins(
            for: [withPin, unknownKey, noKey],
            geo: geo
        )

        // Ровно один пин — и только с координатой из библиотеки; никаких
        // выдуманных позиций для остальных двух.
        XCTAssertEqual(selection.pins.count, 1)
        XCTAssertEqual(selection.missing, 2)
        let pin = try XCTUnwrap(selection.pins.first)
        XCTAssertEqual(pin.id, withPin.id)
        XCTAssertEqual(pin.name, "Sunway University")
        XCTAssertEqual(pin.country, "MY")
        XCTAssertEqual(pin.city, "Kuala Lumpur")
        XCTAssertEqual(pin.lat, 3.067, accuracy: 0.0001)
        XCTAssertEqual(pin.lng, 101.603, accuracy: 0.0001)
    }

    func testEmptyCatalogYieldsNoPinsAndNoMissing() {
        let selection = UniversityMapPolicy.pins(for: [], geo: [:])
        XCTAssertTrue(selection.pins.isEmpty)
        XCTAssertEqual(selection.missing, 0)
    }
}
