import XCTest

/// Decoder tests against fixtures hand-written from the SQL return shapes of
/// `supabase/migrations/195_platform_university_favorites.sql`:
/// - `set_university_favorite_v1` receipt — 195:92-94
///   `jsonb_build_object('institutionId', …, 'favored', …, 'favoritesCount', …)`
/// - `student_university_favorites_v1` rows — 195:106-113
///   `jsonb_agg(jsonb_build_object('institutionId', …, 'createdAt', …))`,
///   COALESCE to `[]`
/// - `student_university_catalog_by_ids_v1` — 195:159-166: the catalogue page
///   shape (`items` + `nextOffset` NULL), decoded by the SAME
///   `UniversityCatalogPage` type the catalogue list uses.
final class FavoritesDecodingTests: XCTestCase {
    func testDecodesFavoriteReceiptAfterAdd() throws {
        // 195:92-94; favored=true after INSERT … ON CONFLICT DO NOTHING.
        let fixture = """
        {
          "institutionId": "3b8fbd2e-6c1a-4c9e-9a71-0e6f4b1f2a10",
          "favored": true,
          "favoritesCount": 3
        }
        """
        let receipt = try JSONDecoder().decode(FavoriteReceipt.self, from: Data(fixture.utf8))
        XCTAssertEqual(
            receipt.institutionId,
            UUID(uuidString: "3b8fbd2e-6c1a-4c9e-9a71-0e6f4b1f2a10")
        )
        XCTAssertTrue(receipt.favored)
        XCTAssertEqual(receipt.favoritesCount, 3)
    }

    func testDecodesFavoriteReceiptAfterRemove() throws {
        // The same shape reports the factual state after DELETE (195:78-83):
        // favored=false and the remaining count.
        let fixture = """
        {
          "institutionId": "9d0a4a52-2a4f-4b5e-8a86-1c2d3e4f5a6b",
          "favored": false,
          "favoritesCount": 0
        }
        """
        let receipt = try JSONDecoder().decode(FavoriteReceipt.self, from: Data(fixture.utf8))
        XCTAssertFalse(receipt.favored)
        XCTAssertEqual(receipt.favoritesCount, 0)
    }

    func testDecodesOwnFavoritesNewestFirst() throws {
        // 195:106-113: ORDER BY created_at DESC; createdAt is a timestamptz
        // rendered into JSONB (clock_timestamp() default, 195:34).
        let fixture = """
        [
          {
            "institutionId": "3b8fbd2e-6c1a-4c9e-9a71-0e6f4b1f2a10",
            "createdAt": "2026-09-19T10:23:54.123456+00:00"
          },
          {
            "institutionId": "9d0a4a52-2a4f-4b5e-8a86-1c2d3e4f5a6b",
            "createdAt": "2026-09-18T08:00:00+00:00"
          }
        ]
        """
        let favorites = try JSONDecoder().decode(
            [UniversityFavorite].self,
            from: Data(fixture.utf8)
        )
        XCTAssertEqual(favorites.count, 2)
        XCTAssertEqual(
            favorites[0].institutionId,
            UUID(uuidString: "3b8fbd2e-6c1a-4c9e-9a71-0e6f4b1f2a10")
        )
        // The microsecond timestamp parses for display.
        XCTAssertNotNil(PostgresTimestamp.date(from: favorites[0].createdAt))
    }

    func testDecodesEmptyFavorites() throws {
        // 195:106/113: COALESCE(…, '[]'::JSONB) — no rows means [], not null.
        let favorites = try JSONDecoder().decode(
            [UniversityFavorite].self,
            from: Data("[]".utf8)
        )
        XCTAssertTrue(favorites.isEmpty)
    }

    func testDecodesByIdsPageWithNullNextOffset() throws {
        // 195:159-166: same row DTO as student_university_catalog
        // ('id','version','publishedAt','content'), nextOffset always NULL.
        // Content constrained by valid_university_content (148/150/151).
        let fixture = """
        {
          "items": [
            {
              "id": "3b8fbd2e-6c1a-4c9e-9a71-0e6f4b1f2a10",
              "version": 2,
              "publishedAt": "2026-09-17T08:15:30+00:00",
              "content": {
                "name": "Sunway University",
                "country": "MY",
                "city": "Subang Jaya",
                "overview": "Частный университет в агломерации Куала-Лумпура.",
                "websiteUrl": "https://sunwayuniversity.edu.my/",
                "sourceUrl": "https://sunwayuniversity.edu.my/admissions",
                "verifiedOn": "2026-09-01",
                "notes": "",
                "photoKey": "sunway",
                "programs": []
              }
            }
          ],
          "nextOffset": null
        }
        """
        let page = try JSONDecoder().decode(
            UniversityCatalogPage.self,
            from: Data(fixture.utf8)
        )
        XCTAssertNil(page.nextOffset)
        XCTAssertEqual(page.items.count, 1)
        XCTAssertEqual(page.items[0].content.name, "Sunway University")
    }
}
