import CoreGraphics
import Foundation

/// Parser for the strict SVG profile of CSCA figures (contract §15). The
/// figure becomes a list of vector shapes and text runs that SwiftUI Canvas
/// draws natively: no web view, no network, no scripts. Anything outside the
/// profile (element, attribute, colour, entity, DTD, comment) rejects the
/// whole figure, and the screen shows its alt text instead.

enum CSCAPaletteRole: String, CaseIterable {
    case paper, ink, muted, grid, accent, ok

    /// Light colours exactly as stored in the figure data.
    var lightHex: String {
        switch self {
        case .paper: return "#ffffff"
        case .ink: return "#191714"
        case .muted: return "#6b6660"
        case .grid: return "#e4dfd7"
        case .accent: return "#d70217"
        case .ok: return "#177245"
        }
    }

    /// Dark theme replacement, one to one, same as the web (contract §15).
    var darkHex: String {
        switch self {
        case .paper: return "#1e1c19"
        case .ink: return "#f2efe9"
        case .muted: return "#a39d94"
        case .grid: return "#2c2925"
        case .accent: return "#ff4a57"
        case .ok: return "#4cc38a"
        }
    }

    static func from(hex: String) -> CSCAPaletteRole? {
        let lower = hex.lowercased()
        return allCases.first { $0.lightHex == lower }
    }

    /// RGB components 0...1 of `hex`.
    static func components(_ hex: String) -> (Double, Double, Double) {
        let digits = hex.dropFirst()
        let value = UInt32(digits, radix: 16) ?? 0
        return (
            Double((value >> 16) & 0xFF) / 255,
            Double((value >> 8) & 0xFF) / 255,
            Double(value & 0xFF) / 255
        )
    }
}

enum CSCASVGPaint: Equatable {
    case none
    case role(CSCAPaletteRole)
}

enum CSCASVGLineCap: String { case butt, round, square }
enum CSCASVGLineJoin: String { case miter, round, bevel }
enum CSCASVGAnchor: String { case start, middle, end }

/// Presentation attributes with SVG inheritance (unset means inherit).
struct CSCASVGStyle: Equatable {
    var fill: CSCASVGPaint?
    var stroke: CSCASVGPaint?
    var strokeWidth: Double?
    var dash: [Double]?
    var lineCap: CSCASVGLineCap?
    var lineJoin: CSCASVGLineJoin?
    var fillOpacity: Double?
    var strokeOpacity: Double?
    var fontSize: Double?
    var italic: Bool?
    var bold: Bool?
    var anchor: CSCASVGAnchor?
    var baseline: String?

    func inheriting(from parent: CSCASVGStyle) -> CSCASVGStyle {
        CSCASVGStyle(
            fill: fill ?? parent.fill,
            stroke: stroke ?? parent.stroke,
            strokeWidth: strokeWidth ?? parent.strokeWidth,
            dash: dash ?? parent.dash,
            lineCap: lineCap ?? parent.lineCap,
            lineJoin: lineJoin ?? parent.lineJoin,
            fillOpacity: fillOpacity ?? parent.fillOpacity,
            strokeOpacity: strokeOpacity ?? parent.strokeOpacity,
            fontSize: fontSize ?? parent.fontSize,
            italic: italic ?? parent.italic,
            bold: bold ?? parent.bold,
            anchor: anchor ?? parent.anchor,
            baseline: baseline ?? parent.baseline
        )
    }

    // SVG initial values. Default fill is black in SVG; the closest palette
    // colour is ink, so an unset fill renders as ink.
    var resolvedFill: CSCASVGPaint { fill ?? .role(.ink) }
    var resolvedStroke: CSCASVGPaint { stroke ?? .none }
    var resolvedStrokeWidth: Double { strokeWidth ?? 1 }
    var resolvedFontSize: Double { fontSize ?? 16 }
}

struct CSCASVGShape {
    let path: CGPath
    let style: CSCASVGStyle
    /// Element `opacity`, multiplied into fill and stroke.
    let opacity: Double
    let transform: CGAffineTransform
}

struct CSCASVGTextRun: Equatable {
    let text: String
    let dx: Double
    let dy: Double
    let style: CSCASVGStyle
}

struct CSCASVGText {
    let x: Double
    let y: Double
    let runs: [CSCASVGTextRun]
    let style: CSCASVGStyle
    let opacity: Double
    let transform: CGAffineTransform

    var plainText: String { runs.map(\.text).joined() }
}

enum CSCASVGNode {
    case shape(CSCASVGShape)
    case text(CSCASVGText)
}

struct CSCASVGDocument {
    let width: Double
    let height: Double
    let nodes: [CSCASVGNode]

    var aspectRatio: Double { width / height }
}

enum CSCASVGError: Error, Equatable {
    case tooLarge
    case forbiddenMarkup(String)
    case element(String)
    case attribute(String)
    case value(String)
    case colour(String)
    case viewBox
    case malformed
}

enum CSCASVGParser {
    static let maxBytes = 24 * 1024

    static let elements: Set<String> = ["svg", "title", "rect", "line", "circle", "path", "polygon", "text", "tspan"]
    static let attributes: Set<String> = [
        "xmlns", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
        "d", "points", "dx", "dy", "transform", "fill", "stroke", "stroke-width", "stroke-dasharray",
        "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity", "stroke-opacity", "font-family",
        "font-size", "font-style", "font-weight", "text-anchor", "dominant-baseline",
    ]

    static func parse(_ svg: String) throws -> CSCASVGDocument {
        guard svg.utf8.count <= maxBytes else { throw CSCASVGError.tooLarge }
        for marker in ["<!", "<?", "url(", "data:", "href", "<script", "<style", "<foreignObject", "<image"] {
            if svg.range(of: marker, options: .caseInsensitive) != nil {
                throw CSCASVGError.forbiddenMarkup(marker)
            }
        }
        if svg.range(of: #"=\s*'"#, options: .regularExpression) != nil {
            throw CSCASVGError.value("single-quoted attribute")
        }
        // Entities: only the five XML ones and numeric references.
        var scan = svg[...]
        while let amp = scan.firstIndex(of: "&") {
            let rest = scan[amp...]
            let allowed = ["&amp;", "&lt;", "&gt;", "&quot;", "&apos;"].contains { rest.hasPrefix($0) }
                || rest.range(of: #"^&#(x[0-9A-Fa-f]+|[0-9]+);"#, options: .regularExpression) != nil
            guard allowed else { throw CSCASVGError.forbiddenMarkup("entity") }
            scan = scan[scan.index(after: amp)...]
        }
        // Every #rrggbb anywhere must be a palette colour.
        let hexPattern = try NSRegularExpression(pattern: "#[0-9A-Fa-f]{6}")
        let ns = svg as NSString
        for match in hexPattern.matches(in: svg, range: NSRange(location: 0, length: ns.length)) {
            let hex = ns.substring(with: match.range)
            guard CSCAPaletteRole.from(hex: hex) != nil else { throw CSCASVGError.colour(hex) }
        }

        let builder = Builder()
        let parser = XMLParser(data: Data(svg.utf8))
        parser.shouldResolveExternalEntities = false
        parser.shouldProcessNamespaces = false
        parser.delegate = builder
        let ok = parser.parse()
        if let error = builder.error { throw error }
        guard ok, let document = builder.document else { throw CSCASVGError.malformed }
        return document
    }

    // MARK: Attribute values

    static func number(_ raw: String?, _ name: String) throws -> Double? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        guard let value = Double(trimmed), value.isFinite else { throw CSCASVGError.value(name) }
        return value
    }

    static func paint(_ raw: String?) throws -> CSCASVGPaint? {
        guard let raw else { return nil }
        if raw == "none" { return CSCASVGPaint.none }
        guard raw.count == 7, raw.hasPrefix("#"), let role = CSCAPaletteRole.from(hex: raw) else {
            throw CSCASVGError.colour(raw)
        }
        return .role(role)
    }

    /// Presentation attributes of one element. Text is at least 12 units,
    /// 11 only on a `tspan` (indices and powers), as the profile says (§15).
    static func style(_ a: [String: String], element: String) throws -> CSCASVGStyle {
        var style = CSCASVGStyle()
        style.fill = try paint(a["fill"])
        style.stroke = try paint(a["stroke"])
        if let width = try number(a["stroke-width"], "stroke-width") {
            guard width >= 0 else { throw CSCASVGError.value("stroke-width") }
            style.strokeWidth = width
        }
        if let dash = a["stroke-dasharray"] {
            if dash == "none" {
                style.dash = []
            } else {
                let values = try numberList(dash)
                guard !values.isEmpty, values.allSatisfy({ $0 >= 0 }) else { throw CSCASVGError.value("stroke-dasharray") }
                style.dash = values
            }
        }
        if let cap = a["stroke-linecap"] {
            guard let value = CSCASVGLineCap(rawValue: cap) else { throw CSCASVGError.value("stroke-linecap") }
            style.lineCap = value
        }
        if let join = a["stroke-linejoin"] {
            guard let value = CSCASVGLineJoin(rawValue: join) else { throw CSCASVGError.value("stroke-linejoin") }
            style.lineJoin = value
        }
        style.fillOpacity = try unit(a["fill-opacity"], "fill-opacity")
        style.strokeOpacity = try unit(a["stroke-opacity"], "stroke-opacity")
        if let size = try number(a["font-size"], "font-size") {
            guard size >= (element == "tspan" ? 11 : 12) else { throw CSCASVGError.value("font-size") }
            style.fontSize = size
        }
        if let fontStyle = a["font-style"] {
            guard ["normal", "italic"].contains(fontStyle) else { throw CSCASVGError.value("font-style") }
            style.italic = fontStyle == "italic"
        }
        if let weight = a["font-weight"] {
            switch weight {
            case "normal", "400": style.bold = false
            case "bold", "600", "700": style.bold = true
            default: throw CSCASVGError.value("font-weight")
            }
        }
        if let anchor = a["text-anchor"] {
            guard let value = CSCASVGAnchor(rawValue: anchor) else { throw CSCASVGError.value("text-anchor") }
            style.anchor = value
        }
        if let baseline = a["dominant-baseline"] {
            guard ["auto", "alphabetic", "middle", "central", "hanging"].contains(baseline) else {
                throw CSCASVGError.value("dominant-baseline")
            }
            style.baseline = baseline
        }
        return style
    }

    static func unit(_ raw: String?, _ name: String) throws -> Double? {
        guard let value = try number(raw, name) else { return nil }
        guard (0...1).contains(value) else { throw CSCASVGError.value(name) }
        return value
    }

    static func numberList(_ raw: String) throws -> [Double] {
        var scanner = NumberScanner(raw)
        var out: [Double] = []
        while let value = try scanner.nextNumber() { out.append(value) }
        guard scanner.isAtEnd else { throw CSCASVGError.value("number list") }
        return out
    }

    static func transform(_ raw: String?) throws -> CGAffineTransform {
        guard let raw, !raw.isEmpty else { return .identity }
        var result = CGAffineTransform.identity
        let pattern = try NSRegularExpression(pattern: #"\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?"#)
        let ns = raw as NSString
        var consumed = 0
        for match in pattern.matches(in: raw, range: NSRange(location: 0, length: ns.length)) {
            guard match.range.location == consumed else { throw CSCASVGError.value("transform") }
            consumed = match.range.location + match.range.length
            let name = ns.substring(with: match.range(at: 1))
            let args = try numberList(ns.substring(with: match.range(at: 2)))
            let t: CGAffineTransform
            switch (name, args.count) {
            case ("matrix", 6): t = CGAffineTransform(a: args[0], b: args[1], c: args[2], d: args[3], tx: args[4], ty: args[5])
            case ("translate", 1): t = CGAffineTransform(translationX: args[0], y: 0)
            case ("translate", 2): t = CGAffineTransform(translationX: args[0], y: args[1])
            case ("scale", 1): t = CGAffineTransform(scaleX: args[0], y: args[0])
            case ("scale", 2): t = CGAffineTransform(scaleX: args[0], y: args[1])
            case ("rotate", 1): t = CGAffineTransform(rotationAngle: args[0] * .pi / 180)
            case ("rotate", 3):
                t = CGAffineTransform(translationX: args[1], y: args[2])
                    .rotated(by: args[0] * .pi / 180)
                    .translatedBy(x: -args[1], y: -args[2])
            case ("skewX", 1): t = CGAffineTransform(a: 1, b: 0, c: tan(args[0] * .pi / 180), d: 1, tx: 0, ty: 0)
            case ("skewY", 1): t = CGAffineTransform(a: 1, b: tan(args[0] * .pi / 180), c: 0, d: 1, tx: 0, ty: 0)
            default: throw CSCASVGError.value("transform")
            }
            // SVG lists apply left to right: the rightmost is innermost.
            result = t.concatenating(result)
        }
        guard consumed == ns.length else { throw CSCASVGError.value("transform") }
        return result
    }

    // MARK: Builder

    private final class Builder: NSObject, XMLParserDelegate {
        var document: CSCASVGDocument?
        var error: CSCASVGError?

        private var stack: [String] = []
        private var nodes: [CSCASVGNode] = []
        private var rootStyle = CSCASVGStyle()
        private var size: (Double, Double)?
        private var sawRoot = false

        private struct OpenText {
            var x: Double
            var y: Double
            var style: CSCASVGStyle
            var opacity: Double
            var transform: CGAffineTransform
            var runs: [CSCASVGTextRun] = []
            var pending: (dx: Double, dy: Double, style: CSCASVGStyle)?
        }
        private var text: OpenText?

        private func fail(_ e: CSCASVGError, _ parser: XMLParser) {
            if error == nil { error = e }
            parser.abortParsing()
        }

        func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                    qualifiedName: String?, attributes a: [String: String] = [:]) {
            guard error == nil else { return }
            guard CSCASVGParser.elements.contains(name) else { return fail(.element(name), parser) }
            for key in a.keys where !CSCASVGParser.attributes.contains(key) {
                return fail(.attribute(key), parser)
            }
            let parent = stack.last
            switch (parent, name) {
            case (nil, "svg"):
                guard !sawRoot else { return fail(.malformed, parser) }
                sawRoot = true
            case ("svg", "title"), ("svg", "rect"), ("svg", "line"), ("svg", "circle"),
                 ("svg", "path"), ("svg", "polygon"), ("svg", "text"), ("text", "tspan"):
                break
            default:
                return fail(.element(name), parser)
            }
            stack.append(name)
            do {
                try start(name, a)
            } catch let e as CSCASVGError {
                fail(e, parser)
            } catch {
                fail(.malformed, parser)
            }
        }

        private func start(_ name: String, _ a: [String: String]) throws {
            let style = try CSCASVGParser.style(a, element: name)
            let opacity = try CSCASVGParser.unit(a["opacity"], "opacity") ?? 1
            let transform = try CSCASVGParser.transform(a["transform"])
            func n(_ key: String, _ fallback: Double? = nil) throws -> Double {
                if let value = try CSCASVGParser.number(a[key], key) { return value }
                if let fallback { return fallback }
                throw CSCASVGError.value(key)
            }
            func shape(_ path: CGPath) {
                nodes.append(.shape(CSCASVGShape(
                    path: path, style: style.inheriting(from: rootStyle), opacity: opacity, transform: transform
                )))
            }
            switch name {
            case "svg":
                guard let raw = a["viewBox"] else { throw CSCASVGError.viewBox }
                let box = try CSCASVGParser.numberList(raw)
                guard box.count == 4, box[0] == 0, box[1] == 0,
                      (360...450).contains(box[2]), (100...600).contains(box[3]) else {
                    throw CSCASVGError.viewBox
                }
                size = (box[2], box[3])
                rootStyle = style
            case "title":
                break
            case "rect":
                let width = try n("width"), height = try n("height")
                guard width >= 0, height >= 0 else { throw CSCASVGError.value("rect") }
                let rx = try CSCASVGParser.number(a["rx"], "rx")
                let ry = try CSCASVGParser.number(a["ry"], "ry")
                let cornerX = min(rx ?? ry ?? 0, width / 2), cornerY = min(ry ?? rx ?? 0, height / 2)
                let rect = CGRect(x: try n("x", 0), y: try n("y", 0), width: width, height: height)
                shape(CGPath(roundedRect: rect, cornerWidth: max(0, cornerX), cornerHeight: max(0, cornerY), transform: nil))
            case "line":
                let path = CGMutablePath()
                path.move(to: CGPoint(x: try n("x1", 0), y: try n("y1", 0)))
                path.addLine(to: CGPoint(x: try n("x2", 0), y: try n("y2", 0)))
                shape(path)
            case "circle":
                let r = try n("r")
                guard r >= 0 else { throw CSCASVGError.value("r") }
                let cx = try n("cx", 0), cy = try n("cy", 0)
                shape(CGPath(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r), transform: nil))
            case "path":
                guard let d = a["d"] else { throw CSCASVGError.value("d") }
                shape(try CSCASVGPathData.parse(d))
            case "polygon":
                guard let raw = a["points"] else { throw CSCASVGError.value("points") }
                let values = try CSCASVGParser.numberList(raw)
                guard values.count >= 4, values.count % 2 == 0 else { throw CSCASVGError.value("points") }
                let path = CGMutablePath()
                path.move(to: CGPoint(x: values[0], y: values[1]))
                var index = 2
                while index < values.count {
                    path.addLine(to: CGPoint(x: values[index], y: values[index + 1]))
                    index += 2
                }
                path.closeSubpath()
                shape(path)
            case "text":
                var open = OpenText(
                    x: try n("x", 0), y: try n("y", 0),
                    style: style.inheriting(from: rootStyle),
                    opacity: opacity, transform: transform
                )
                if a["dx"] != nil || a["dy"] != nil {
                    open.pending = (try n("dx", 0), try n("dy", 0), open.style)
                }
                text = open
            case "tspan":
                guard var open = text else { throw CSCASVGError.malformed }
                guard a["x"] == nil, a["y"] == nil, a["transform"] == nil else {
                    throw CSCASVGError.attribute("tspan position")
                }
                open.pending = (try n("dx", 0), try n("dy", 0), style.inheriting(from: open.style))
                text = open
            default:
                throw CSCASVGError.element(name)
            }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            guard error == nil, var open = text, let current = stack.last, current == "text" || current == "tspan" else { return }
            let pending = open.pending ?? (0, 0, open.style)
            open.runs.append(CSCASVGTextRun(text: string, dx: pending.dx, dy: pending.dy, style: pending.style))
            // dx/dy shift once, at the first character of the element.
            open.pending = (0, 0, pending.style)
            text = open
        }

        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
            guard error == nil else { return }
            stack.removeLast()
            switch name {
            case "tspan":
                if var open = text {
                    open.pending = (0, 0, open.style)
                    text = open
                }
            case "text":
                if let open = text {
                    let runs = Self.collapse(open.runs)
                    if !runs.isEmpty {
                        nodes.append(.text(CSCASVGText(
                            x: open.x, y: open.y, runs: runs, style: open.style,
                            opacity: open.opacity, transform: open.transform
                        )))
                    }
                }
                text = nil
            case "svg":
                guard let size else { return fail(.viewBox, parser) }
                document = CSCASVGDocument(width: size.0, height: size.1, nodes: nodes)
            default:
                break
            }
        }

        func parser(_ parser: XMLParser, parseErrorOccurred parseError: Error) {
            if error == nil { error = .malformed }
        }

        /// SVG whitespace handling without xml:space: line breaks and tabs
        /// become spaces, runs of spaces collapse, the text element is
        /// trimmed at both ends. Runs that become empty keep their dy.
        static func collapse(_ runs: [CSCASVGTextRun]) -> [CSCASVGTextRun] {
            var out: [CSCASVGTextRun] = []
            var previousEndsWithSpace = true
            for run in runs {
                var collapsed = ""
                for ch in run.text {
                    let isSpace = ch == " " || ch == "\n" || ch == "\t" || ch == "\r"
                    if isSpace {
                        if !previousEndsWithSpace { collapsed.append(" ") }
                        previousEndsWithSpace = true
                    } else {
                        collapsed.append(ch)
                        previousEndsWithSpace = false
                    }
                }
                out.append(CSCASVGTextRun(text: collapsed, dx: run.dx, dy: run.dy, style: run.style))
            }
            if let lastIndex = out.lastIndex(where: { !$0.text.isEmpty }), out[lastIndex].text.hasSuffix(" ") {
                let run = out[lastIndex]
                out[lastIndex] = CSCASVGTextRun(text: String(run.text.dropLast()), dx: run.dx, dy: run.dy, style: run.style)
            }
            return out.allSatisfy({ $0.text.isEmpty }) ? [] : out
        }
    }
}

// MARK: - Numbers and path data

struct NumberScanner {
    private let chars: [Character]
    private(set) var index = 0

    init(_ raw: String) { chars = Array(raw) }

    var isAtEnd: Bool {
        var i = index
        while i < chars.count, chars[i] == " " || chars[i] == "," || chars[i] == "\n" || chars[i] == "\t" || chars[i] == "\r" { i += 1 }
        return i >= chars.count
    }

    mutating func skipSeparators() {
        while index < chars.count, chars[index] == " " || chars[index] == "," || chars[index] == "\n" || chars[index] == "\t" || chars[index] == "\r" {
            index += 1
        }
    }

    func peek() -> Character? {
        index < chars.count ? chars[index] : nil
    }

    mutating func advance() { index += 1 }

    /// The next number (SVG grammar: sign, digits, one dot, exponent), or
    /// nil when the next token is not a number.
    mutating func nextNumber() throws -> Double? {
        skipSeparators()
        let start = index
        var i = index
        if i < chars.count, chars[i] == "+" || chars[i] == "-" { i += 1 }
        var digits = 0
        while i < chars.count, chars[i].isASCII, chars[i].isNumber { i += 1; digits += 1 }
        if i < chars.count, chars[i] == "." {
            i += 1
            while i < chars.count, chars[i].isASCII, chars[i].isNumber { i += 1; digits += 1 }
        }
        guard digits > 0 else { return nil }
        if i < chars.count, chars[i] == "e" || chars[i] == "E" {
            var j = i + 1
            if j < chars.count, chars[j] == "+" || chars[j] == "-" { j += 1 }
            var expDigits = 0
            while j < chars.count, chars[j].isASCII, chars[j].isNumber { j += 1; expDigits += 1 }
            if expDigits > 0 { i = j }
        }
        guard let value = Double(String(chars[start..<i])), value.isFinite else { throw CSCASVGError.value("number") }
        index = i
        return value
    }

    /// Arc flags are single characters 0 or 1, possibly without separators.
    mutating func nextFlag() throws -> Bool {
        skipSeparators()
        guard let ch = peek(), ch == "0" || ch == "1" else { throw CSCASVGError.value("arc flag") }
        advance()
        return ch == "1"
    }
}

enum CSCASVGPathData {
    static func parse(_ d: String) throws -> CGPath {
        var scanner = NumberScanner(d)
        let path = CGMutablePath()
        var current = CGPoint.zero
        var subpathStart = CGPoint.zero
        var lastControl: CGPoint?
        var lastQuadControl: CGPoint?
        var command: Character?
        var started = false

        func number() throws -> Double {
            guard let value = try scanner.nextNumber() else { throw CSCASVGError.value("path number") }
            return value
        }

        while true {
            scanner.skipSeparators()
            guard let ch = scanner.peek() else { break }
            if ch.isLetter {
                guard "MmLlHhVvCcSsQqTtAaZz".contains(ch) else { throw CSCASVGError.value("path command") }
                command = ch
                scanner.advance()
            } else if command == nil {
                throw CSCASVGError.value("path start")
            }
            guard let cmd = command else { break }
            let relative = cmd.isLowercase
            let base = relative ? current : .zero
            func point(_ x: Double, _ y: Double) -> CGPoint {
                CGPoint(x: base.x + x, y: base.y + y)
            }
            if !started, cmd != "M", cmd != "m" { throw CSCASVGError.value("path start") }
            switch cmd {
            case "M", "m":
                let p = point(try number(), try number())
                path.move(to: p)
                current = p
                subpathStart = p
                started = true
                // Further pairs after a moveto are implicit linetos.
                command = relative ? "l" : "L"
                lastControl = nil; lastQuadControl = nil
            case "L", "l":
                let p = point(try number(), try number())
                path.addLine(to: p)
                current = p
                lastControl = nil; lastQuadControl = nil
            case "H", "h":
                let x = try number()
                let p = CGPoint(x: relative ? current.x + x : x, y: current.y)
                path.addLine(to: p)
                current = p
                lastControl = nil; lastQuadControl = nil
            case "V", "v":
                let y = try number()
                let p = CGPoint(x: current.x, y: relative ? current.y + y : y)
                path.addLine(to: p)
                current = p
                lastControl = nil; lastQuadControl = nil
            case "C", "c":
                let c1 = point(try number(), try number())
                let c2 = point(try number(), try number())
                let p = point(try number(), try number())
                path.addCurve(to: p, control1: c1, control2: c2)
                lastControl = c2; lastQuadControl = nil
                current = p
            case "S", "s":
                let c1 = lastControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let c2 = point(try number(), try number())
                let p = point(try number(), try number())
                path.addCurve(to: p, control1: c1, control2: c2)
                lastControl = c2; lastQuadControl = nil
                current = p
            case "Q", "q":
                let c = point(try number(), try number())
                let p = point(try number(), try number())
                path.addQuadCurve(to: p, control: c)
                lastQuadControl = c; lastControl = nil
                current = p
            case "T", "t":
                let c = lastQuadControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let p = point(try number(), try number())
                path.addQuadCurve(to: p, control: c)
                lastQuadControl = c; lastControl = nil
                current = p
            case "A", "a":
                let rx = abs(try number()), ry = abs(try number())
                let rotation = try number()
                let largeArc = try scanner.nextFlag()
                let sweep = try scanner.nextFlag()
                let p = point(try number(), try number())
                addArc(path, from: current, to: p, rx: rx, ry: ry, rotation: rotation, largeArc: largeArc, sweep: sweep)
                current = p
                lastControl = nil; lastQuadControl = nil
            case "Z", "z":
                path.closeSubpath()
                current = subpathStart
                lastControl = nil; lastQuadControl = nil
                command = nil
                continue
            default:
                throw CSCASVGError.value("path command")
            }
        }
        return path
    }

    /// Endpoint arc to cubic Béziers (SVG 1.1 implementation notes F.6.5).
    static func addArc(_ path: CGMutablePath, from p0: CGPoint, to p1: CGPoint, rx inRx: Double, ry inRy: Double,
                       rotation: Double, largeArc: Bool, sweep: Bool) {
        if p0 == p1 { return }
        var rx = inRx, ry = inRy
        if rx == 0 || ry == 0 {
            path.addLine(to: p1)
            return
        }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1p = cosPhi * dx + sinPhi * dy
        let y1p = -sinPhi * dx + cosPhi * dy
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 {
            rx *= sqrt(lambda)
            ry *= sqrt(lambda)
        }
        let numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        let denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        var factor = sqrt(max(0, numerator / denominator))
        if largeArc == sweep { factor = -factor }
        let cxp = factor * rx * y1p / ry
        let cyp = -factor * ry * x1p / rx
        let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2

        func angle(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double {
            let dot = ux * vx + uy * vy
            let len = sqrt(ux * ux + uy * uy) * sqrt(vx * vx + vy * vy)
            var a = acos(max(-1, min(1, dot / len)))
            if ux * vy - uy * vx < 0 { a = -a }
            return a
        }
        let theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
        var delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
        if !sweep, delta > 0 { delta -= 2 * .pi }
        if sweep, delta < 0 { delta += 2 * .pi }

        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / Double(segments)
        let k = 4.0 / 3.0 * tan(step / 4)
        var t = theta1
        for _ in 0..<segments {
            let cos1 = cos(t), sin1 = sin(t)
            let cos2 = cos(t + step), sin2 = sin(t + step)
            func map(_ x: Double, _ y: Double) -> CGPoint {
                CGPoint(x: cx + rx * x * cosPhi - ry * y * sinPhi, y: cy + rx * x * sinPhi + ry * y * cosPhi)
            }
            let c1 = map(cos1 - k * sin1, sin1 + k * cos1)
            let c2 = map(cos2 + k * sin2, sin2 - k * cos2)
            let end = map(cos2, sin2)
            path.addCurve(to: end, control1: c1, control2: c2)
            t += step
        }
    }
}
