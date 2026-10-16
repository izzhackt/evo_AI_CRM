import UIKit
import XCTest

/// Когда загрузчик фото перестаёт просить варианты размера: только если
/// вариант отказал, а оригинал того же объекта загрузился. 404 одного
/// недозагруженного объекта варианты для остальных фото не выключает.
final class AtlasImageLoaderTests: XCTestCase {
    /// Ответы по адресу; без записи 404. Счётчик запросов по адресу.
    final class Stub: URLProtocol {
        private static let lock = NSLock()
        private static var statuses: [String: Int] = [:]
        private static var requested: [String] = []
        static var png = Data()

        static func reset(_ map: [String: Int]) {
            lock.withLock {
                statuses = map
                requested = []
            }
        }

        static var requests: [String] { lock.withLock { requested } }

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            let url = request.url!
            let status = Self.lock.withLock {
                Self.requested.append(url.absoluteString)
                return Self.statuses[url.absoluteString] ?? 404
            }
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: nil)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: status == 200 ? Self.png : Data())
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }

    private let base = URL(string: "https://photos.example.test/")!

    override func setUp() {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8))
        Stub.png = renderer.pngData { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
    }

    private func loader() -> AtlasImageLoader {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Stub.self]
        configuration.urlCache = nil
        return AtlasImageLoader(configuration: configuration)
    }

    private func source(_ object: String) -> AtlasPhotoSource {
        let candidates = [
            AtlasPhotoURL.sized(base: base, path: object, width: 640).map { AtlasPhotoCandidate(url: $0, sized: true) },
            AtlasPhotoURL.original(base: base, path: object).map { AtlasPhotoCandidate(url: $0, sized: false) },
        ].compactMap { $0 }
        return AtlasPhotoSource(candidates: candidates)
    }

    private func url(_ object: String, sized: Bool) -> String {
        sized
            ? "https://photos.example.test/storage/v1/render/image/public/portal-university-photos/\(object)?width=640&quality=70"
            : "https://photos.example.test/storage/v1/object/public/portal-university-photos/\(object)"
    }

    func testMissingObjectDoesNotSwitchOffSizedVariants() async {
        let loader = loader()
        // Объект ещё не загружен: 404 и у варианта, и у оригинала.
        Stub.reset([url("b.jpg", sized: true): 200])
        let missing = await loader.image(for: source("a.jpg"), maxPixel: 640)
        XCTAssertNil(missing)
        let transformationsOff = await loader.transformationsUnavailable
        XCTAssertFalse(transformationsOff)
        // Следующее фото по-прежнему берёт вариант размера.
        let next = await loader.image(for: source("b.jpg"), maxPixel: 640)
        XCTAssertNotNil(next)
        XCTAssertEqual(Stub.requests.last, url("b.jpg", sized: true))
    }

    func testRejectedVariantWithAWorkingOriginalSwitchesToOriginals() async {
        let loader = loader()
        // Трансформаций нет (локальный стек, тариф): вариант 400, оригинал 200.
        Stub.reset([
            url("a.jpg", sized: true): 400,
            url("a.jpg", sized: false): 200,
            url("b.jpg", sized: true): 200,
            url("b.jpg", sized: false): 200,
        ])
        let first = await loader.image(for: source("a.jpg"), maxPixel: 640)
        XCTAssertNotNil(first)
        let transformationsOff = await loader.transformationsUnavailable
        XCTAssertTrue(transformationsOff)
        // До конца запуска сразу оригинал.
        let second = await loader.image(for: source("b.jpg"), maxPixel: 640)
        XCTAssertNotNil(second)
        XCTAssertEqual(Stub.requests.last, url("b.jpg", sized: false))
        XCTAssertFalse(Stub.requests.contains(url("b.jpg", sized: true)))
    }
}
