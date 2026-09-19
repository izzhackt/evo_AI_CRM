import Foundation

/// One reviewed campus photo with its CC/source attribution — the same
/// library the web portal renders (`src/lib/university-photo-library.json`,
/// bundled from that exact file via project.yml). `photoKey` values are
/// validated server-side (migrations 148/150/151), so an unknown key here
/// simply falls back to the honest "no photo" state.
struct UniversityPhoto: Decodable {
    let path: String
    let author: String
    let title: String
    let caption: String
    let sourceUrl: String
    let license: String
    let licenseUrl: String
}

enum UniversityPhotoLibrary {
    static let shared: [String: UniversityPhoto] = load(from: .main) ?? [:]

    static func load(from bundle: Bundle) -> [String: UniversityPhoto]? {
        guard
            let url = bundle.url(forResource: "university-photo-library", withExtension: "json"),
            let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode([String: UniversityPhoto].self, from: data)
    }

    static func photo(for key: String?) -> UniversityPhoto? {
        guard let key else { return nil }
        return shared[key]
    }
}
