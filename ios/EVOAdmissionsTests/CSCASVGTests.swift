import CoreGraphics
import XCTest

/// The native figure renderer accepts the nine real figures of the pilot
/// and rejects everything outside the strict profile (contract §15).
final class CSCASVGTests: XCTestCase {
    /// All figures served by the real lesson and test responses.
    static func realFigures() throws -> [String: CSCAFigure] {
        var figures: [String: CSCAFigure] = [:]
        for name in [
            "csca_lesson_m2-exp-log-l1", "csca_lesson_m2-derivative-l1", "csca_lesson_m3-line-circle-l1",
            "csca_lesson_m2-exp-log-p1", "csca_lesson_m2-derivative-p1", "csca_lesson_m3-line-circle-p1",
        ] {
            let lesson = try CSCADecodingTests.decode(CSCALessonResponse.self, name)
            figures.merge(lesson.figures) { first, _ in first }
        }
        for name in ["csca_test_start_mock", "csca_test_start_diagnostic"] {
            figures.merge(try CSCADecodingTests.decode(CSCATestAttempt.self, name).figures) { first, _ in first }
        }
        return figures
    }

    func testAllNineRealFiguresParse() throws {
        let figures = try Self.realFigures()
        XCTAssertEqual(figures.count, 9)
        for (key, figure) in figures {
            let document = try CSCASVGParser.parse(figure.svg)
            let box = figure.viewBox.split(separator: " ").compactMap { Double($0) }
            XCTAssertEqual(document.width, box[2], key)
            XCTAssertEqual(document.height, box[3], key)
            // Same number of drawable elements as in the source.
            let shapes = ["<rect", "<line", "<circle", "<path", "<polygon"].reduce(0) {
                $0 + figure.svg.components(separatedBy: $1).count - 1
            }
            let texts = figure.svg.components(separatedBy: "<text").count - 1
            var parsedShapes = 0, parsedTexts = 0
            for node in document.nodes {
                switch node {
                case .shape: parsedShapes += 1
                case .text: parsedTexts += 1
                }
            }
            XCTAssertEqual(parsedShapes, shapes, key)
            XCTAssertEqual(parsedTexts, texts, key)
            XCTAssertFalse(figure.altRu.isEmpty || figure.altKy.isEmpty || figure.altEn.isEmpty, key)
        }
    }

    func testTextRunsKeepSuperscriptShiftsAndSpaces() throws {
        let svg = svgDocument("""
        <text x="10" y="50" font-size="15" fill="#191714" text-anchor="middle">y = 2<tspan dy="-7" font-size="11">x</tspan><tspan dy="7"> </tspan>and <tspan font-style="italic">d</tspan> &gt; <tspan font-style="italic">r</tspan></text>
        """)
        let document = try CSCASVGParser.parse(svg)
        guard case .text(let text) = try XCTUnwrap(document.nodes.first) else { return XCTFail("text") }
        XCTAssertEqual(text.plainText, "y = 2x and d > r")
        XCTAssertEqual(text.style.anchor, .middle)
        let sup = try XCTUnwrap(text.runs.first { $0.text == "x" })
        XCTAssertEqual(sup.dy, -7)
        XCTAssertEqual(sup.style.resolvedFontSize, 11)
        XCTAssertEqual(text.runs.first { $0.text == "d" }?.style.italic, true)
        XCTAssertEqual(text.runs.reduce(0) { $0 + $1.dy }, 0, "baseline returns after the superscript")
    }

    func testPaletteRolesAndDarkSwap() throws {
        let document = try CSCASVGParser.parse(svgDocument(
            ##"<line x1="0" y1="0" x2="10" y2="10" stroke="#D70217" stroke-width="2" stroke-dasharray="4 4"/>"##
        ))
        guard case .shape(let shape) = try XCTUnwrap(document.nodes.first) else { return XCTFail("shape") }
        XCTAssertEqual(shape.style.resolvedStroke, .role(.accent))
        XCTAssertEqual(shape.style.dash, [4, 4])
        XCTAssertEqual(CSCAPaletteRole.accent.darkHex, "#ff4a57")
        XCTAssertEqual(CSCAPaletteRole.allCases.count, 6)
    }

    func testPathGrammarBeyondThePilot() throws {
        // Relative commands, implicit lineto, H/V, curves and an arc.
        let path = try CSCASVGPathData.parse("M10 10 l20 0 20 10 H80 V40 h-10 v-5 C60 40 50 50 40 40 S20 30 10 40 Q5 30 10 20 T10 10 A10 10 0 0 1 30 10 a5 5 0 1 0 10 0 z")
        let box = path.boundingBoxOfPath
        XCTAssertGreaterThan(box.width, 60)
        XCTAssertFalse(path.isEmpty)
        XCTAssertThrowsError(try CSCASVGPathData.parse("L10 10"), "must start with a moveto")
        XCTAssertThrowsError(try CSCASVGPathData.parse("M10 10 X5 5"))
    }

    func testTransformList() throws {
        let t = try CSCASVGParser.transform("translate(10 20) rotate(90)")
        let p = CGPoint(x: 1, y: 0).applying(t)
        XCTAssertEqual(p.x, 10, accuracy: 0.0001)
        XCTAssertEqual(p.y, 21, accuracy: 0.0001)
        XCTAssertThrowsError(try CSCASVGParser.transform("translate(10 20) bogus(1)"))
    }

    func testOutOfProfileFiguresAreRejected() {
        let cases: [(String, String)] = [
            ("script", svgDocument("<script>alert(1)</script>")),
            ("style attribute", svgDocument(#"<rect width="10" height="10" style="fill:red"/>"#)),
            ("href", svgDocument(#"<image href="x.png" width="1" height="1"/>"#)),
            ("foreign colour", svgDocument(##"<rect width="10" height="10" fill="#123456"/>"##)),
            ("event handler", svgDocument(#"<rect width="10" height="10" onclick="x()"/>"#)),
            ("group element", svgDocument(#"<g><rect width="10" height="10"/></g>"#)),
            ("url paint", svgDocument(##"<rect width="10" height="10" fill="url(#g)"/>"##)),
            ("named entity", svgDocument("<text x=\"1\" y=\"1\" font-size=\"12\">&nbsp;</text>")),
            ("single quotes", svgDocument("<rect width='10' height='10'/>")),
            ("tiny text", svgDocument(#"<text x="1" y="1" font-size="8">a</text>"#)),
            ("11 outside a tspan", svgDocument(#"<text x="1" y="1" font-size="11">a</text>"#)),
            ("negative stroke", svgDocument(##"<line x1="0" y1="0" x2="1" y2="1" stroke="#191714" stroke-width="-1"/>"##)),
            ("doctype", "<!DOCTYPE svg>" + svgDocument("")),
            ("comment", svgDocument("<!-- note -->")),
            ("narrow viewBox", #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"></svg>"#),
            ("offset viewBox", #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 0 400 300"></svg>"#),
            ("two roots", svgDocument("") + svgDocument("")),
            ("oversize", svgDocument(String(repeating: #"<line x1="0" y1="0" x2="1" y2="1"/>"#, count: 800))),
        ]
        for (name, svg) in cases {
            XCTAssertThrowsError(try CSCASVGParser.parse(svg), name)
        }
    }

    private func svgDocument(_ body: String) -> String {
        #"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300" font-family="Golos Text, sans-serif">"#
            + body + "</svg>"
    }
}
