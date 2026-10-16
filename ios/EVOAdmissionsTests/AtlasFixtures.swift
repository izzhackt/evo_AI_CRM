import Foundation
import XCTest

/// Реальные ответы RPC 283 демо-стека `evo-video-demo` (синтетические
/// данные, студент демо, 16.10.2026): `student_university_index_v1` без
/// версии и с текущей версией, `student_university_detail_v1` для Tongji
/// University (строки сайта университета и агентств, CNY) и Bilkent
/// University (строки в USD и TRY, год есть не у всех строк). Файлы
/// сохранены байт в байт, как их вернул PostgREST.
enum AtlasFixtures {
    private final class Token {}

    static func data(_ name: String, file: StaticString = #filePath, line: UInt = #line) throws -> Data {
        guard let url = Bundle(for: Token.self).url(forResource: name, withExtension: "json") else {
            XCTFail("Fixture \(name).json is missing from the test bundle", file: file, line: line)
            throw CocoaError(.fileNoSuchFile)
        }
        return try Data(contentsOf: url)
    }

    static func object(_ name: String) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data(name)) as? [String: Any])
    }

    /// Тот же реальный ответ с точечной правкой: проверка, что строгий
    /// разбор отвергает одно конкретное отклонение от контракта.
    static func mutated(_ name: String, _ change: (inout [String: Any]) throws -> Void) throws -> Data {
        var value = try object(name)
        try change(&value)
        return try JSONSerialization.data(withJSONObject: value)
    }

    static let index = "atlas-index-demo"
    static let notModified = "atlas-index-not-modified-demo"
    static let tongji = "atlas-detail-tongji-demo"
    static let bilkent = "atlas-detail-bilkent-demo"
}

/// Подготовки в тестах разбора страницы вуза: форму строк проверяет слой
/// подготовок приложения, здесь важен только конверт.
struct PreparationStub: Decodable {
    init(from decoder: Decoder) throws {}
}

typealias DetailUnderTest = UniversityDetailPayload<PreparationStub>

extension Dictionary where Key == String, Value == Any {
    /// Изменить вложенный объект по пути ключей и индексов массивов.
    mutating func update(_ path: [Any], _ change: (inout [String: Any]) -> Void) {
        self = Self.updating(self, path: path[...], change)
    }

    private static func updating(_ object: [String: Any], path: ArraySlice<Any>, _ change: (inout [String: Any]) -> Void) -> [String: Any] {
        var object = object
        guard let head = path.first else {
            change(&object)
            return object
        }
        let key = head as! String
        let rest = path.dropFirst()
        if let index = rest.first as? Int {
            var array = object[key] as! [Any]
            array[index] = updating(array[index] as! [String: Any], path: rest.dropFirst(), change)
            object[key] = array
        } else {
            object[key] = updating(object[key] as! [String: Any], path: rest, change)
        }
        return object
    }
}
