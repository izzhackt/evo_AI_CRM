import Foundation

/// Один адрес фото в порядке попытки. `sized`: вариант нужного размера
/// через Image Transformations Supabase; если он отказал, а оригинал того же
/// объекта загрузился (тариф без трансформаций, локальный стек), загрузчик
/// до конца запуска берёт сразу оригиналы.
struct AtlasPhotoCandidate: Equatable, Hashable {
    let url: URL
    let sized: Bool
}

/// Откуда грузить фото карточки: адреса по порядку, первый удачный
/// показывается. Без адресов фото нет (честная заглушка, не чужое фото).
struct AtlasPhotoSource: Equatable, Hashable {
    let candidates: [AtlasPhotoCandidate]
}

/// Адреса публичного бакета `portal-university-photos` (контракт 2.5):
/// оригинал `/storage/v1/object/public/<bucket>/<path>` и вариант размера
/// `/storage/v1/render/image/public/<bucket>/<path>?width=…&quality=70`.
/// Пути содержат sha256 файла (новое фото это новый путь), поэтому ответы
/// можно держать в кэше долго.
enum AtlasPhotoURL {
    static let bucket = "portal-university-photos"
    static let quality = 70
    /// Ширины вариантов в пикселях: несколько ступеней вместо точной ширины
    /// экрана, чтобы карточки разного размера попадали в один кэш.
    static let widthSteps = [320, 480, 640, 800, 1080, 1280, 1600, 2048]

    /// Ступень не меньше нужной ширины (точки × масштаб экрана).
    static func widthStep(points: Double, scale: Double) -> Int {
        let pixels = Int((points * max(scale, 1)).rounded(.up))
        return widthSteps.first { $0 >= pixels } ?? widthSteps[widthSteps.count - 1]
    }

    /// Путь объекта без обхода каталогов и посторонних символов.
    static func isObjectPath(_ path: String) -> Bool {
        AtlasValue.matches(path, "[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)*") && !path.contains("..")
    }

    private static func encodedPath(_ path: String) -> String? {
        guard isObjectPath(path) else { return nil }
        return path.split(separator: "/").map {
            String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0)
        }.joined(separator: "/")
    }

    static func original(base: URL, path: String) -> URL? {
        guard let encoded = encodedPath(path) else { return nil }
        return URL(string: "\(trimmed(base))/storage/v1/object/public/\(bucket)/\(encoded)")
    }

    static func sized(base: URL, path: String, width: Int) -> URL? {
        guard let encoded = encodedPath(path), width > 0 else { return nil }
        return URL(string: "\(trimmed(base))/storage/v1/render/image/public/\(bucket)/\(encoded)?width=\(width)&quality=\(quality)")
    }

    private static func trimmed(_ base: URL) -> String {
        var value = base.absoluteString
        while value.hasSuffix("/") { value.removeLast() }
        return value
    }

    /// Фото страны или города: вариант размера, затем оригинал.
    static func geography(_ photo: AtlasPhoto, base: URL, width: Int) -> AtlasPhotoSource {
        let candidates = [
            sized(base: base, path: photo.path, width: width).map { AtlasPhotoCandidate(url: $0, sized: true) },
            original(base: base, path: photo.path).map { AtlasPhotoCandidate(url: $0, sized: false) },
        ].compactMap { $0 }
        return AtlasPhotoSource(candidates: candidates)
    }

    /// Фото вуза по тому же правилу, что `resolveManagedUniversityPhotoUrl`
    /// веба (студенческие экраны, план 4.4, 5.3, приёмка 7.6.5): только
    /// перенесённая копия из бакета (запись манифеста verified и migrated),
    /// сначала вариант размера, затем оригинал того же объекта. Фото, которое
    /// ещё не перенесено, студенту не показывается: адресов нет, экран рисует
    /// заглушку «фото не добавлено», прямой ссылки на сайт вуза или Wikimedia
    /// нет. Неизвестный ключ: фото нет.
    static func university(
        photoKey: String?,
        library: [String: UniversityPhoto],
        manifest: [String: UniversityPhotoManifestEntry],
        base: URL,
        width: Int
    ) -> AtlasPhotoSource {
        guard let objectPath = managedUniversityObjectPath(photoKey: photoKey, library: library, manifest: manifest) else {
            return AtlasPhotoSource(candidates: [])
        }
        let candidates = [
            sized(base: base, path: objectPath, width: width).map { AtlasPhotoCandidate(url: $0, sized: true) },
            original(base: base, path: objectPath).map { AtlasPhotoCandidate(url: $0, sized: false) },
        ].compactMap { $0 }
        return AtlasPhotoSource(candidates: candidates)
    }

    /// Есть ли у вуза фото для студента: ключ известен библиотеке и копия
    /// перенесена. От этого зависят заглушка и кнопка «©».
    static func hasUniversityPhoto(
        photoKey: String?,
        library: [String: UniversityPhoto],
        manifest: [String: UniversityPhotoManifestEntry]
    ) -> Bool {
        managedUniversityObjectPath(photoKey: photoKey, library: library, manifest: manifest) != nil
    }

    private static func managedUniversityObjectPath(
        photoKey: String?,
        library: [String: UniversityPhoto],
        manifest: [String: UniversityPhotoManifestEntry]
    ) -> String? {
        guard let photoKey, library[photoKey] != nil else { return nil }
        return UniversityPhotoManifest.managedObjectPath(photoKey: photoKey, entries: manifest)
    }
}

/// Автор, источник и лицензия фото по кнопке «©» (план 4.4, контракт 2.5).
/// Подпись под карточкой не печатается, но атрибуция CC BY и CC BY-SA
/// остаётся рядом с каждым фото, которое видит студент, и ведёт туда же, что
/// у веба (`PhotoRights`, review раунда 2 веба, F13):
/// - фото страны или города: автор ссылкой на свою страницу (только если
///   она есть), источник всегда ссылкой на страницу файла, лицензия ссылкой
///   на текст лицензии;
/// - фото вуза с открытой лицензией: автор ссылкой на страницу файла,
///   лицензия ссылкой (источник отдельно не называется, как на вебе);
/// - официальные медиа вуза (решение владельца Р3): «Фото: <вуз>,
///   официальный сайт» ссылкой на страницу сайта вуза.
struct AtlasPhotoCredit: Equatable {
    enum Kind: Equatable {
        case author
        /// Фото с собственного сайта вуза: название вуза для подписи.
        case official(university: String)
    }

    struct Source: Equatable {
        let name: String
        let url: URL
    }

    let kind: Kind
    /// Что на фото (страна, город или вуз): VoiceOver читает это значением
    /// кнопки «©», и одинаковые кнопки на экране различимы (review раунда 3, p1).
    let subject: String
    let caption: String?
    let author: String
    let authorUrl: URL?
    let source: Source?
    /// Страница фото на сайте вуза (только у официальных медиа).
    let officialUrl: URL?
    let license: String
    let licenseUrl: URL?
    let cropped: Bool

    /// Фото страны или города.
    init(place photo: AtlasPhoto, subject: String) {
        kind = .author
        self.subject = subject
        caption = nil
        author = photo.author
        authorUrl = photo.authorUrl
        source = Source(name: photo.sourceName, url: photo.sourceUrl)
        officialUrl = nil
        license = photo.license
        licenseUrl = photo.licenseUrl
        cropped = true
    }

    /// Подпись фото вуза; nil, если фото студенту не показывается (ключ
    /// неизвестен или копия не перенесена): тогда и кнопки «©» нет.
    init?(
        universityPhotoKey: String?,
        universityName: String,
        library: [String: UniversityPhoto] = UniversityPhotoLibrary.shared,
        manifest: [String: UniversityPhotoManifestEntry] = UniversityPhotoManifest.shared
    ) {
        guard AtlasPhotoURL.hasUniversityPhoto(photoKey: universityPhotoKey, library: library, manifest: manifest),
              let universityPhotoKey, let photo = library[universityPhotoKey] else { return nil }
        let page = URL(string: photo.sourceUrl)
        subject = universityName
        caption = photo.caption
        author = photo.author
        source = nil
        license = photo.license
        licenseUrl = URL(string: photo.licenseUrl)
        cropped = true
        if UniversityPhotoRights.isOfficialMedia(license: photo.license) {
            kind = .official(university: universityName)
            authorUrl = nil
            officialUrl = page
        } else {
            kind = .author
            authorUrl = page
            officialUrl = nil
        }
    }
}

/// Права на фото вуза (план 4.4, решение владельца Р3), как
/// `src/lib/university-photo-rights.ts` веба: фото с собственного сайта вуза
/// без открытой лицензии подписывается «Фото: <вуз>, официальный сайт», а не
/// служебной строкой лицензии библиотеки.
enum UniversityPhotoRights {
    /// Точные строки лицензий библиотеки для собственного сайта вуза
    /// (`OFFICIAL_MEDIA_LICENSES` веба).
    static let officialMediaLicenses: Set<String> = [
        "Official-source embedding; no reuse license stated",
        "All rights reserved; official-source embedding",
    ]

    static func isOfficialMedia(license: String) -> Bool {
        officialMediaLicenses.contains(license)
    }
}

/// Запись манифеста переноса фото вузов
/// (`scripts/portal/university-photos-manifest.json`, ресурс bundle).
struct UniversityPhotoManifestEntry: Decodable, Equatable {
    let status: String
    let migrated: Bool
    let objectPath: String?
}

enum UniversityPhotoManifest {
    private struct File: Decodable {
        let entries: [String: UniversityPhotoManifestEntry]
    }

    static let shared: [String: UniversityPhotoManifestEntry] = load(from: Bundle(for: ManifestBundleToken.self)) ?? [:]

    static func load(from bundle: Bundle) -> [String: UniversityPhotoManifestEntry]? {
        guard let url = bundle.url(forResource: "university-photos-manifest", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return decode(data)
    }

    static func decode(_ data: Data) -> [String: UniversityPhotoManifestEntry]? {
        (try? JSONDecoder().decode(File.self, from: data))?.entries
    }

    /// Плоское имя файла, привязанное к ключу (`<photoKey>.<ext>`), только
    /// у проверенной и перенесённой записи; иначе nil (как веб).
    static func managedObjectPath(photoKey: String, entries: [String: UniversityPhotoManifestEntry]) -> String? {
        guard let entry = entries[photoKey], entry.status == "verified", entry.migrated,
              let path = entry.objectPath,
              AtlasValue.matches(path, "[a-z0-9][a-z0-9-]*\\.(avif|gif|jpg|png|webp)"),
              path.hasPrefix("\(photoKey).") else { return nil }
        return path
    }
}

private final class ManifestBundleToken {}
