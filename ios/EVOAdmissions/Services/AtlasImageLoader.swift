import ImageIO
import UIKit

/// Загрузка фото каталога (страны, города, вузы): свой `URLCache` на диске,
/// уменьшение до размера карточки при декодировании (ImageIO) и кэш готовых
/// картинок в памяти. Адреса пробуются по порядку `AtlasPhotoSource`: если
/// сервер не отдаёт варианты размера (тариф без Image Transformations,
/// локальный стек), а оригинал того же объекта отдаёт, до конца запуска
/// запрашивается сразу оригинал.
actor AtlasImageLoader {
    static let shared = AtlasImageLoader()

    private let session: URLSession
    private let memory = NSCache<NSString, UIImage>()
    private var sizedUnavailable = false
    private var failedURLs: Set<URL> = []
    private var inFlight: [String: Task<UIImage?, Never>] = [:]

    /// - Parameter configuration: сеть загрузчика; тесты подставляют свою
    ///   (заглушка `URLProtocol`, без кэша на диске).
    init(configuration: URLSessionConfiguration = AtlasImageLoader.standardConfiguration()) {
        session = URLSession(configuration: configuration)
        memory.totalCostLimit = 48 * 1024 * 1024
    }

    static func standardConfiguration() -> URLSessionConfiguration {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let cache = URLCache(
            memoryCapacity: 16 * 1024 * 1024,
            diskCapacity: 200 * 1024 * 1024,
            directory: caches.appendingPathComponent("catalog-photos", isDirectory: true)
        )
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = cache
        // Пути фото географ и вузов привязаны к содержимому (sha256 или ключ
        // библиотеки сборки): сохранённый ответ годится без повторной сверки.
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.timeoutIntervalForRequest = 30
        return configuration
    }

    /// Варианты размера выключены до конца запуска.
    var transformationsUnavailable: Bool { sizedUnavailable }

    /// Картинка не больше `maxPixel` по длинной стороне или nil (все адреса
    /// не ответили).
    func image(for source: AtlasPhotoSource, maxPixel: Int) async -> UIImage? {
        let key = "\(maxPixel)|" + source.candidates.map(\.url.absoluteString).joined(separator: "|")
        if let cached = memory.object(forKey: key as NSString) { return cached }
        if let running = inFlight[key] { return await running.value }
        let task = Task { await self.load(source, maxPixel: maxPixel) }
        inFlight[key] = task
        let image = await task.value
        inFlight[key] = nil
        if let image {
            let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
            memory.setObject(image, forKey: key as NSString, cost: cost)
        }
        return image
    }

    private func load(_ source: AtlasPhotoSource, maxPixel: Int) async -> UIImage? {
        // Вариант размера этого фото ответил 4xx. Это говорит о недоступных
        // трансформациях, только если оригинал того же объекта затем
        // загрузится: 404 одного недозагруженного объекта (фото стран и
        // городов загружает отдельный шаг выпуска) варианты не выключает.
        var sizedRejected = false
        for candidate in source.candidates {
            if candidate.sized, sizedUnavailable { continue }
            if failedURLs.contains(candidate.url) { continue }
            let request = URLRequest(url: candidate.url)
            do {
                let (data, response) = try await session.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(status) else {
                    // Отказ не остаётся в кэше: иначе он пережил бы запуск.
                    session.configuration.urlCache?.removeCachedResponse(for: request)
                    if candidate.sized, (400..<500).contains(status) { sizedRejected = true }
                    failedURLs.insert(candidate.url)
                    continue
                }
                if let image = Self.downsample(data, maxPixel: maxPixel) {
                    if sizedRejected, !candidate.sized { sizedUnavailable = true }
                    return image
                }
                failedURLs.insert(candidate.url)
            } catch {
                if Task.isCancelled { return nil }
                // Сетевой сбой не помечает адрес навсегда: следующий показ
                // попробует снова.
                continue
            }
        }
        return nil
    }

    private static func downsample(_ data: Data, maxPixel: Int) -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else { return nil }
        let options = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(64, maxPixel),
        ] as CFDictionary
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }
        return UIImage(cgImage: image)
    }
}
