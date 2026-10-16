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

    /// Фото вуза по тому же правилу, что `resolveUniversityPhotoUrl` веба:
    /// перенесённое фото (запись манифеста verified и migrated) грузится
    /// только из бакета, сначала вариант размера, затем оригинал того же
    /// объекта; прямой ссылки на сайт вуза у него нет (план 5.3, приёмка
    /// 7.6, п. 5). Прямая ссылка библиотеки остаётся только у фото, которое
    /// ещё не перенесено. Неизвестный ключ: фото нет.
    static func university(
        photoKey: String?,
        library: [String: UniversityPhoto],
        manifest: [String: UniversityPhotoManifestEntry],
        base: URL,
        width: Int
    ) -> AtlasPhotoSource {
        guard let photoKey, let photo = library[photoKey] else { return AtlasPhotoSource(candidates: []) }
        if let objectPath = UniversityPhotoManifest.managedObjectPath(photoKey: photoKey, entries: manifest) {
            let candidates = [
                sized(base: base, path: objectPath, width: width).map { AtlasPhotoCandidate(url: $0, sized: true) },
                original(base: base, path: objectPath).map { AtlasPhotoCandidate(url: $0, sized: false) },
            ].compactMap { $0 }
            return AtlasPhotoSource(candidates: candidates)
        }
        guard let hotlink = AtlasValue.httpsURL(photo.path) else { return AtlasPhotoSource(candidates: []) }
        return AtlasPhotoSource(candidates: [.init(url: hotlink, sized: false)])
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
              let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(File.self, from: data) else { return nil }
        return file.entries
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
