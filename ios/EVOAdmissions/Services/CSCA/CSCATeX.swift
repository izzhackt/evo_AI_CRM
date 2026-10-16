import Foundation

/// TeX subset handling shared by every CSCA text field (contract §14):
/// splitting a string at `$` into text and inline formulas, and building a
/// spoken VoiceOver label from a formula with simple rules
/// (`\frac{a}{b}` «a over b», `^2` «squared», `\log_a` «log base a»).
enum CSCAMathSegment: Equatable {
    case text(String)
    case math(String)
}

enum CSCATeX {
    /// `$` is always a delimiter (no currency in content); odd positions
    /// between delimiters are formulas. An unmatched trailing `$` stays text.
    static func segments(_ source: String) -> [CSCAMathSegment] {
        let parts = source.components(separatedBy: "$")
        var out: [CSCAMathSegment] = []
        let closed = parts.count % 2 == 1
        for (index, part) in parts.enumerated() {
            let isMath = index % 2 == 1
            if isMath, !closed, index == parts.count - 1 {
                appendText("$" + part, to: &out)
            } else if isMath {
                if !part.isEmpty { out.append(.math(part)) }
            } else {
                appendText(part, to: &out)
            }
        }
        return out
    }

    private static func appendText(_ text: String, to out: inout [CSCAMathSegment]) {
        guard !text.isEmpty else { return }
        if case .text(let previous) = out.last {
            out[out.count - 1] = .text(previous + text)
        } else {
            out.append(.text(text))
        }
    }

    /// Every formula of a string, for render checks.
    static func formulas(in source: String) -> [String] {
        segments(source).compactMap { segment in
            if case .math(let tex) = segment { return tex }
            return nil
        }
    }

    /// Plain spoken form of a whole mixed string: text as is, formulas
    /// through `spoken(_:)`.
    static func spokenText(_ source: String) -> String {
        segments(source).map { segment -> String in
            switch segment {
            case .text(let text): return text
            case .math(let tex): return spoken(tex)
            }
        }
        .joined()
        .replacingOccurrences(of: "  ", with: " ")
    }

    // MARK: Speech

    static func spoken(_ tex: String) -> String {
        var parser = SpeechParser(tokens: tokenize(tex))
        let words = parser.parseSequence(until: nil)
        return words
            .joined(separator: " ")
            .replacingOccurrences(of: " ,", with: ",")
            .replacingOccurrences(of: "( ", with: "(")
            .replacingOccurrences(of: " )", with: ")")
            .split(separator: " ", omittingEmptySubsequences: true)
            .joined(separator: " ")
    }

    enum Token: Equatable {
        case command(String)
        case char(Character)
        case open
        case close
        case superscript
        case subscriptMark
    }

    static func tokenize(_ tex: String) -> [Token] {
        var tokens: [Token] = []
        var index = tex.startIndex
        while index < tex.endIndex {
            let ch = tex[index]
            switch ch {
            case "\\":
                var next = tex.index(after: index)
                guard next < tex.endIndex else { index = next; continue }
                if tex[next].isLetter {
                    var end = next
                    while end < tex.endIndex, tex[end].isLetter { end = tex.index(after: end) }
                    tokens.append(.command(String(tex[next..<end])))
                    index = end
                } else {
                    // \{ \} \, and similar: the escaped character itself.
                    tokens.append(.char(tex[next]))
                    next = tex.index(after: next)
                    index = next
                }
                continue
            case "{": tokens.append(.open)
            case "}": tokens.append(.close)
            case "^": tokens.append(.superscript)
            case "_": tokens.append(.subscriptMark)
            case " ", "\t", "\n": break
            default: tokens.append(.char(ch))
            }
            index = tex.index(after: index)
        }
        return tokens
    }

    private static let words: [String: String] = [
        "infty": "infinity", "in": "in", "notin": "not in", "cdot": "times", "times": "times",
        "leq": "less than or equal to", "geq": "greater than or equal to", "ne": "not equal to",
        "pm": "plus or minus", "Rightarrow": "implies", "Leftrightarrow": "if and only if",
        "to": "approaches", "approx": "approximately equals", "ldots": "and so on",
        "cap": "intersect", "cup": "union", "subseteq": "is a subset of", "emptyset": "empty set",
        "parallel": "parallel", "perp": "perpendicular", "Delta": "delta", "pi": "pi",
        "alpha": "alpha", "beta": "beta", "theta": "theta", "mu": "mu", "sigma": "sigma",
        "omega": "omega", "varphi": "phi", "circ": "degrees", "quad": ",",
        "sin": "sine", "cos": "cosine", "tan": "tangent", "ln": "natural log of", "lim": "limit",
    ]

    private static let blackboard: [String: String] = [
        "R": "the real numbers", "N": "the natural numbers", "Z": "the integers", "Q": "the rational numbers",
    ]

    private static let symbols: [Character: String] = [
        "+": "plus", "-": "minus", "=": "equals", "<": "less than", ">": "greater than",
        "/": "divided by", "!": "factorial", "'": "prime", ",": ",", ".": ".",
        "(": "(", ")": ")", "[": "[", "]": "]", "{": "{", "}": "}",
    ]

    fileprivate struct SpeechParser {
        let tokens: [Token]
        var position = 0
        var absoluteOpen = false

        init(tokens: [Token]) { self.tokens = tokens }

        mutating func next() -> Token? {
            guard position < tokens.count else { return nil }
            defer { position += 1 }
            return tokens[position]
        }

        func peek() -> Token? {
            position < tokens.count ? tokens[position] : nil
        }

        func nextIsDigit(after offset: Int) -> Bool {
            let index = position + offset
            guard index < tokens.count, case .char(let ch) = tokens[index] else { return false }
            return ch.isNumber
        }

        /// One argument: a braced group or a single token.
        mutating func parseArgument() -> [String] {
            guard let token = peek() else { return [] }
            if token == .open {
                position += 1
                return parseSequence(until: .close)
            }
            // Unbraced script or argument: exactly one character, as in TeX
            // (`\log_2 8` is log base 2 of 8, not of 28).
            if case .char(let ch) = token {
                position += 1
                return [CSCATeX.symbols[ch] ?? String(ch)]
            }
            return parseAtom()
        }

        mutating func parseSequence(until terminator: Token?) -> [String] {
            var out: [String] = []
            while let token = peek() {
                if let terminator, token == terminator {
                    position += 1
                    break
                }
                out += parseAtom()
            }
            return out
        }

        mutating func parseAtom() -> [String] {
            guard let token = next() else { return [] }
            switch token {
            case .open:
                return parseSequence(until: .close)
            case .close:
                return []
            case .superscript:
                return parsePower()
            case .subscriptMark:
                return ["sub"] + parseArgument()
            case .char(let ch):
                if ch == "|" {
                    absoluteOpen.toggle()
                    return absoluteOpen ? ["absolute value of"] : [","]
                }
                if ch.isNumber {
                    // A whole number reads as one word: «30», «0.3».
                    var number = String(ch)
                    while case .char(let next)? = peek(), next.isNumber || (next == "." && nextIsDigit(after: 1)) {
                        number.append(next)
                        position += 1
                    }
                    return [number]
                }
                if let word = CSCATeX.symbols[ch] { return [word] }
                return [String(ch)]
            case .command(let name):
                switch name {
                case "frac":
                    let numerator = parseArgument()
                    let denominator = parseArgument()
                    return numerator + ["over"] + denominator + [","]
                case "sqrt":
                    return ["square root of"] + parseArgument() + [","]
                case "log":
                    if peek() == .subscriptMark {
                        position += 1
                        return ["log base"] + parseArgument() + ["of"]
                    }
                    return ["log of"]
                case "mathbb":
                    let inner = parseArgument().joined()
                    return [CSCATeX.blackboard[inner] ?? inner]
                case "left", "right":
                    return []
                default:
                    return [CSCATeX.words[name] ?? name]
                }
            }
        }

        mutating func parsePower() -> [String] {
            if case .command("circ") = peek() {
                position += 1
                return ["degrees"]
            }
            let exponent = parseArgument()
            switch exponent {
            case ["2"]: return ["squared"]
            case ["3"]: return ["cubed"]
            default: return ["to the power"] + exponent + [","]
            }
        }
    }
}
