import XCTest

/// Заливки под белым текстом (сведение #1172 и #1210, review merge-1 M1).
/// `AccentColor` в тёмной теме #FF8A8A: белый на нём 2,27:1, поэтому под
/// белым текстом стоит только `AccentFill` (#D70217 в обеих темах) или
/// постоянный фирменный цвет. Тесты читают исходники приложения (путь от
/// этого файла, `#filePath`), как `LocalizationKeysTests`.
final class FillContrastSourceTests: XCTestCase {
    private static let appSources = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent("EVOAdmissions")

    private func swiftSources() throws -> [(name: String, lines: [String])] {
        let files = try XCTUnwrap(FileManager.default.enumerator(at: Self.appSources, includingPropertiesForKeys: nil))
        return try files.compactMap { $0 as? URL }
            .filter { $0.pathExtension == "swift" }
            .map { ($0.lastPathComponent, try String(contentsOf: $0, encoding: .utf8).components(separatedBy: "\n")) }
    }

    private static func isComment(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespaces).hasPrefix("//")
    }

    /// Каждая `.borderedProminent` красится заливкой, на которой белый текст
    /// проходит 4,5:1 и в тёмной теме.
    func testEveryProminentButtonUsesASolidFill() throws {
        let allowed = [".tint(.accentFill)", ".tint(Color.accentFill)", ".tint(CSCAColor.accentFill)", ".tint(Self.brand)"]
        var checked = 0
        var offenders: [String] = []
        for (name, lines) in try swiftSources() {
            for (index, line) in lines.enumerated() where line.contains("buttonStyle(.borderedProminent)") {
                if Self.isComment(line) { continue }
                checked += 1
                let sameLine = line.components(separatedBy: "buttonStyle(.borderedProminent)").last ?? ""
                let next = lines[(index + 1)...].first { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ?? ""
                let tint = sameLine.contains(".tint(") ? sameLine : next
                if !allowed.contains(where: tint.contains) { offenders.append("\(name):\(index + 1)") }
            }
        }
        XCTAssertGreaterThanOrEqual(checked, 6, "сканер не нашёл кнопок .borderedProminent")
        XCTAssertEqual(offenders, [], ".borderedProminent без AccentFill или постоянного цвета")
    }

    /// Сплошной `AccentColor` (и `CSCAColor.accent`) не стоит заливкой или
    /// фоном: под заливкой в коде белый текст или значок. Тонировка
    /// `.opacity(…)` под основным текстом допустима.
    func testAccentColorIsNeverASolidFill() throws {
        let pattern = try NSRegularExpression(pattern:
            #"\.(?:fill|background)\([^\n]*(?:CSCAColor\.accent(?![A-Za-z]|\.opacity)|Color\("AccentColor"\)(?!\.opacity))"#)
        var offenders: [String] = []
        for (name, lines) in try swiftSources() {
            for (index, line) in lines.enumerated() where !Self.isComment(line) {
                let range = NSRange(line.startIndex..., in: line)
                if pattern.firstMatch(in: line, range: range) != nil { offenders.append("\(name):\(index + 1)") }
            }
        }
        XCTAssertEqual(offenders, [], "AccentColor заливкой: в тёмной теме белый на нём 2,27:1")
    }
}
