import SwiftMath
import UIKit
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
        // A longer fraction gets audible edges.
        XCTAssertEqual(
            CSCATeX.spoken("\\frac{u'v - uv'}{v^2}"),
            "the fraction u prime v minus u v prime over v squared end fraction,"
        )
    }

    /// `'` is the prime glyph, as in TeX and KaTeX (SwiftMath alone draws an
    /// upright quote).
    func testPrimesBecomePrimeGlyphs() {
        XCTAssertEqual(CSCATeX.primesForTypesetting("f'(x)"), "f\\prime(x)")
        XCTAssertEqual(CSCATeX.primesForTypesetting("f''(x) > 0"), "f\\prime\\prime(x) > 0")
        XCTAssertEqual(CSCATeX.primesForTypesetting("u'v + uv'"), "u\\prime v + uv\\prime")
        // After `\right)` a negative thin space keeps the prime on the bracket.
        XCTAssertEqual(
            CSCATeX.primesForTypesetting("\\left(\\frac{u}{v}\\right)' = \\frac{u'v - uv'}{v^2}"),
            "\\left(\\frac{u}{v}\\right)\\!\\prime = \\frac{u\\prime v - uv\\prime}{v^2}"
        )
        XCTAssertEqual(CSCATeX.primesForTypesetting("f'^2"), "f\\prime^2")
        // Not primes: text apostrophes and the escaped accent.
        XCTAssertEqual(CSCATeX.primesForTypesetting("\\text{it's} f'"), "\\text{it's} f\\prime")
        XCTAssertEqual(CSCATeX.primesForTypesetting("\\'e"), "\\'e")
        XCTAssertEqual(CSCATeX.primesForTypesetting("x^2 + 1"), "x^2 + 1")
    }

    /// Layout snapshot of three prime formulas from the derivative lesson:
    /// SwiftMath sets U+2032 prime atoms right after their base (the
    /// variable, the closing `\\right)`), no upquote accent, no lifted
    /// superscript line.
    func testPrimeFormulasTypesetAsPrimeGlyphs() throws {
        let cases: [(tex: String, primes: Int)] = [
            ("f'(x) = 3x^2 - 12", 1),
            ("y'' = 3x^2", 2),
            ("\\left(\\frac{u}{v}\\right)' = \\frac{u'v - uv'}{v^2}", 1),
        ]
        for (tex, primes) in cases {
            let rewritten = CSCATeX.primesForTypesetting(tex)
            var error: NSError?
            let list = try XCTUnwrap(MTMathListBuilder.build(fromString: rewritten, error: &error), tex)
            XCTAssertNil(error, tex)
            let atoms = list.atoms.filter { $0.type != .space }
            XCTAssertEqual(atoms.dropFirst().prefix(primes).map(\.nucleus), Array(repeating: "\u{2032}", count: primes), tex)
            XCTAssertTrue(atoms.dropFirst().prefix(primes).allSatisfy { $0.type == .ordinary }, tex)
            XCTAssertNil(atoms.first?.superScript, "no lifted superscript: \(tex)")
            XCTAssertFalse(list.atoms.contains { $0.type == .accent }, "no upquote accent: \(tex)")

            // The primes add no superscript line to the layout.
            func superscriptLines(_ source: String) throws -> Int {
                let label = MTMathUILabel()
                label.labelMode = .display
                label.fontSize = 20
                label.latex = source
                label.frame = CGRect(origin: .zero, size: label.intrinsicContentSize)
                label.layoutIfNeeded()
                let display = try XCTUnwrap(label.displayList, source)
                return display.subDisplays.compactMap { $0 as? MTMathListDisplay }.filter { $0.type == .superscript }.count
            }
            XCTAssertEqual(
                try superscriptLines(rewritten),
                try superscriptLines(tex.replacingOccurrences(of: "'", with: "")),
                "primes stay on the base line: \(tex)"
            )
        }
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
            // What the app typesets: primes rewritten as prime glyphs.
            let list = MTMathListBuilder.build(fromString: CSCATeX.primesForTypesetting(tex), error: &error)
            if list == nil || error != nil { failures.append(tex) }
            let spoken = CSCATeX.spoken(tex)
            XCTAssertFalse(spoken.contains("\\"), tex)
            XCTAssertFalse(spoken.isEmpty, tex)
        }
        XCTAssertEqual(failures, [], "SwiftMath could not parse \(failures.count) fragments")
    }
}
