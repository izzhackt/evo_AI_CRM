import Foundation

/// One verified campus coordinate with its provenance — the SAME repo
/// library the web map renders (`src/lib/university-geo-library.json`,
/// bundled from that exact file via project.yml, same single-source pattern
/// as `university-photo-library.json`). Keys are `photoKey` values; each
/// entry carries its own provenance (`sourceUrl` — Wikidata entity,
/// `verifiedOn` — verification date). An institution without an entry simply
/// has no pin — the plan forbids invented positions (план §6, «Карта»).
struct UniversityGeoEntry: Decodable {
    let lat: Double
    let lng: Double
    let sourceUrl: String
    let verifiedOn: String
}

enum UniversityGeoLibrary {
    static let shared: [String: UniversityGeoEntry] = load(from: .main) ?? [:]

    static func load(from bundle: Bundle) -> [String: UniversityGeoEntry]? {
        guard
            let url = bundle.url(forResource: "university-geo-library", withExtension: "json"),
            let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode([String: UniversityGeoEntry].self, from: data)
    }

    static func entry(for photoKey: String?) -> UniversityGeoEntry? {
        guard let photoKey else { return nil }
        return shared[photoKey]
    }
}
