import Foundation

/// Копия индекса 283 на диске (контракт 2.4): точное тело последнего
/// полного ответа RPC, по файлу на организацию. Версия берётся из самого
/// тела, поэтому копия и её версия не расходятся. Индекс одинаков для всех
/// студентов организации и личных данных не содержит; файл лежит в Caches
/// (система может его удалить, тогда индекс просто читается заново).
/// Копия с неверной обёрткой (старый формат, повреждение) удаляется и не
/// показывается. Части, которые разбор опускает, журнал отметил при
/// получении ответа, поэтому чтение копии журнал не пишет.
struct UniversityIndexDiskCache {
    let directory: URL

    /// Номер формата копии: новая форма индекса это новая функция и новый
    /// файл, старая копия не читается новым разбором.
    static let format = "index-v1"

    static var standard: UniversityIndexDiskCache {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return UniversityIndexDiskCache(directory: caches.appendingPathComponent("university-index", isDirectory: true))
    }

    func fileURL(organizationId: UUID) -> URL {
        directory.appendingPathComponent("\(Self.format)-\(organizationId.uuidString.lowercased()).json")
    }

    /// Сохранённый индекс организации или nil.
    func read(organizationId: UUID) -> UniversityIndex? {
        let url = fileURL(organizationId: organizationId)
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard case .full(let index)? = try? UniversityIndexResponse.decode(data) else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        return index
    }

    /// Записывает тело полного ответа. Тело `notModified` не пишется:
    /// прежняя копия остаётся.
    func write(_ data: Data, organizationId: UUID) throws {
        guard case .full = try UniversityIndexResponse.decode(data) else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var options: Data.WritingOptions = [.atomic]
        #if os(iOS)
        options.insert(.completeFileProtectionUntilFirstUserAuthentication)
        #endif
        try data.write(to: fileURL(organizationId: organizationId), options: options)
    }

    func remove(organizationId: UUID) {
        try? FileManager.default.removeItem(at: fileURL(organizationId: organizationId))
    }
}
