import SwiftMath
import XCTest

final class CSCATeXTests: XCTestCase {
    func testSegmentsSplitAtDollar() {
        XCTAssertEqual(CSCATeX.segments("Find $\\log_2 8$."), [.text("Find "), .math("\\log_2 8"), .text(".")])
        XCTAssertEqual(CSCATeX.segments("$6$"), [.math("6")])
        XCTAssertEqual(CSCATeX.segments("no math"), [.text("no math")])
        XCTAssertEqual(CSCATeX.segments("a $x$ b $y$"), [.text("a "), .math("x"), .text(" b "), .math("y")])
        // An unmatched dollar stays text instead of swallowing the rest.
        XCTAssertEqual(CSCATeX.segments("cost $5"), [.text("cost $5")])
    }

    func testSpokenRules() {
        XCTAssertEqual(CSCATeX.spoken("\\frac{a}{b}"), "a over b,")
        XCTAssertEqual(CSCATeX.spoken("x^2"), "x squared")
        XCTAssertEqual(CSCATeX.spoken("\\log_2 8"), "log base 2 of 8")
        XCTAssertEqual(CSCATeX.spoken("\\sqrt{2}"), "square root of 2,")
        XCTAssertEqual(CSCATeX.spoken("x \\leq 3"), "x less than or equal to 3")
        XCTAssertEqual(CSCATeX.spoken("x \\in \\mathbb{R}"), "x in the real numbers")
        XCTAssertEqual(CSCATeX.spoken("30^\\circ"), "30 degrees")
        XCTAssertEqual(CSCATeX.spoken("2^{0.3}"), "2 to the power 0.3,")
        XCTAssertEqual(CSCATeX.spoken("12 = 2 \\cdot 6"), "12 equals 2 times 6")
        XCTAssertEqual(CSCATeX.spoken("2^{-x}"), "2 to the power minus x,")
        XCTAssertEqual(CSCATeX.spoken("y_0"), "y sub 0")
        XCTAssertFalse(CSCATeX.spoken("\\left(\\frac{1}{2}\\right)^{-x}").contains("\\"))
    }

    /// Every formula in the real responses: KaTeX-validated subset parses
    /// in SwiftMath too (contract §14), and the spoken label has no TeX.
    func testEveryFixtureFormulaParsesInSwiftMath() throws {
        let bundle = Bundle(for: CSCATeXTests.self)
        let urls = try XCTUnwrap(bundle.urls(forResourcesWithExtension: "json", subdirectory: nil))
            .filter { $0.lastPathComponent.hasPrefix("csca_") && !$0.lastPathComponent.contains(".error") }
        XCTAssertGreaterThan(urls.count, 20)
        var formulas = Set<String>()
        func walk(_ value: Any, key: String?) {
            if let dict = value as? [String: Any] {
                for (k, v) in dict where k != "svg" { walk(v, key: k) }
            } else if let array = value as? [Any] {
                for v in array { walk(v, key: key) }
            } else if let string = value as? String {
                if key == "tex" {
                    formulas.insert(string)
                } else {
                    CSCATeX.formulas(in: string).forEach { formulas.insert($0) }
                }
            }
        }
        for url in urls {
            walk(try JSONSerialization.jsonObject(with: Data(contentsOf: url)), key: nil)
        }
        XCTAssertGreaterThan(formulas.count, 300)
        var failures: [String] = []
        for tex in formulas {
            var error: NSError?
            let list = MTMathListBuilder.build(fromString: tex, error: &error)
            if list == nil || error != nil { failures.append(tex) }
            let spoken = CSCATeX.spoken(tex)
            XCTAssertFalse(spoken.contains("\\"), tex)
            XCTAssertFalse(spoken.isEmpty, tex)
        }
        XCTAssertEqual(failures, [], "SwiftMath could not parse \(failures.count) fragments")
    }
}
