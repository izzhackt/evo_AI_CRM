import SwiftMath
import SwiftUI
import UIKit

/// Formulas through SwiftMath (MIT). Every `$…$` fragment is typeset once
/// into a template image (black, so it takes the colour of the surrounding
/// text in both appearances) and placed inside SwiftUI `Text`, which lets a
/// formula wrap with the sentence it belongs to. Display formulas (`tex[]`
/// of a formula block) are centred on their own line. Sizes follow Dynamic
/// Type; VoiceOver reads a spoken label built from the TeX.
@MainActor
final class CSCAMathRenderer {
    static let shared = CSCAMathRenderer()

    struct Rendered {
        let image: UIImage
        /// Distance from the image bottom to the formula baseline.
        let baselineFromBottom: CGFloat
    }

    private var cache: [String: Rendered] = [:]
    private var failed: Set<String> = []

    func render(_ tex: String, fontSize: CGFloat, display: Bool) -> Rendered? {
        let key = "\(display ? "D" : "T")|\(Int((fontSize * 10).rounded()))|\(tex)"
        if let hit = cache[key] { return hit }
        if failed.contains(key) { return nil }
        guard let rendered = Self.typeset(tex, fontSize: fontSize, display: display) else {
            failed.insert(key)
            return nil
        }
        if cache.count > 2000 { cache.removeAll(keepingCapacity: true) }
        cache[key] = rendered
        return rendered
    }

    /// Whether SwiftMath parses `tex` without an error (used by the tests).
    static func parses(_ tex: String) -> Bool {
        var error: NSError?
        let list = MTMathListBuilder.build(fromString: tex, error: &error)
        return list != nil && error == nil
    }

    private static func typeset(_ tex: String, fontSize: CGFloat, display: Bool) -> Rendered? {
        guard parses(tex) else { return nil }
        let label = MTMathUILabel()
        label.displayErrorInline = false
        label.labelMode = display ? .display : .text
        label.fontSize = fontSize
        label.textColor = .black
        label.latex = tex
        guard label.error == nil else { return nil }
        let size = label.intrinsicContentSize
        guard size.width > 0, size.height > 0, size.width.isFinite, size.height.isFinite else { return nil }
        label.frame = CGRect(x: 0, y: 0, width: ceil(size.width), height: ceil(size.height))
        label.setNeedsLayout()
        label.layoutIfNeeded()
        guard let displayList = label.displayList else { return nil }
        let bounds = label.bounds
        // Italic glyphs (P, f) reach past their advance width on the right:
        // pad the canvas there so their edges are not clipped.
        let padRight = ceil(fontSize * 0.07)
        let padY = ceil(fontSize * 0.03)
        let canvas = CGSize(width: bounds.width + padRight, height: bounds.height + 2 * padY)
        let image = UIGraphicsImageRenderer(size: canvas).image { context in
            let cg = context.cgContext
            cg.saveGState()
            cg.translateBy(x: 0, y: canvas.height - padY)
            cg.scaleBy(x: 1, y: -1)
            displayList.draw(cg)
            cg.restoreGState()
        }
        // Same vertical placement as MTMathUILabel's layout: the line is
        // centred in the bounds, so the baseline sits `descent` above the
        // bottom plus half of any rounding slack.
        let lineHeight = max(displayList.ascent + displayList.descent, fontSize / 2)
        let baseline = (bounds.height - lineHeight) / 2 + displayList.descent + padY
        return Rendered(
            image: image.withRenderingMode(.alwaysTemplate),
            baselineFromBottom: max(0, baseline)
        )
    }
}

/// Width of the reading column, measured on the scroll view (independent
/// of the content, so a wide formula cannot inflate it). 0 while unknown.
private struct CSCAColumnWidthKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
    var cscaColumnWidth: CGFloat {
        get { self[CSCAColumnWidthKey.self] }
        set { self[CSCAColumnWidthKey.self] = newValue }
    }
}

extension View {
    /// Measures the scroll view and hands the column width to formulas.
    func cscaReadingColumn(maxWidth: CGFloat = 680, horizontalPadding: CGFloat = 20) -> some View {
        modifier(CSCAReadingColumn(maxWidth: maxWidth, horizontalPadding: horizontalPadding))
    }
}

private struct CSCAReadingColumn: ViewModifier {
    let maxWidth: CGFloat
    let horizontalPadding: CGFloat
    @State private var viewport: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .environment(\.cscaColumnWidth, viewport > 0 ? min(maxWidth, viewport - 2 * horizontalPadding) : 0)
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.size.width
            } action: { width in
                if abs(width - viewport) > 0.5 { viewport = width }
            }
    }
}

enum CSCAType {
    /// Point size of a text style at the current Dynamic Type size.
    static func pointSize(_ style: UIFont.TextStyle, _ size: DynamicTypeSize) -> CGFloat {
        UIFont.preferredFont(
            forTextStyle: style,
            compatibleWith: UITraitCollection(preferredContentSizeCategory: category(size))
        ).pointSize
    }

    static func category(_ size: DynamicTypeSize) -> UIContentSizeCategory {
        switch size {
        case .xSmall: return .extraSmall
        case .small: return .small
        case .medium: return .medium
        case .large: return .large
        case .xLarge: return .extraLarge
        case .xxLarge: return .extraExtraLarge
        case .xxxLarge: return .extraExtraExtraLarge
        case .accessibility1: return .accessibilityMedium
        case .accessibility2: return .accessibilityLarge
        case .accessibility3: return .accessibilityExtraLarge
        case .accessibility4: return .accessibilityExtraExtraLarge
        case .accessibility5: return .accessibilityExtraExtraExtraLarge
        @unknown default: return .large
        }
    }

    static func uiStyle(_ style: Font.TextStyle) -> UIFont.TextStyle {
        switch style {
        case .largeTitle: return .largeTitle
        case .title: return .title1
        case .title2: return .title2
        case .title3: return .title3
        case .headline: return .headline
        case .subheadline: return .subheadline
        case .callout: return .callout
        case .footnote: return .footnote
        case .caption: return .caption1
        case .caption2: return .caption2
        default: return .body
        }
    }
}

/// Mixed text with inline formulas. Text pieces are plain `Text`, formulas
/// are SwiftMath images; a formula wider than the line is scaled down to
/// the available width instead of overflowing.
struct CSCAMathText: View {
    let source: String
    var style: Font.TextStyle = .body
    var weight: Font.Weight = .regular
    /// English learning content (stems, options): VoiceOver reads it in English.
    var isEnglish = false

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.cscaColumnWidth) private var columnWidth
    @State private var availableWidth: CGFloat = 0

    /// The widest a formula may be on this line: the measured width, and
    /// never more than the column less the room cards and option rows take.
    private var formulaLimit: CGFloat {
        let column = columnWidth > 0 ? columnWidth - 100 : .infinity
        let measured = availableWidth > 0 ? availableWidth : .infinity
        return min(column, measured)
    }

    var body: some View {
        composed
            .font(.system(style, weight: weight))
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.size.width
            } action: { width in
                if abs(width - availableWidth) > 0.5 { availableWidth = width }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText)
    }

    private var mathSize: CGFloat {
        CSCAType.pointSize(CSCAType.uiStyle(style), dynamicTypeSize) * 1.02
    }

    private var composed: Text {
        var result = Text(verbatim: "")
        for segment in CSCATeX.segments(source) {
            switch segment {
            case .text(let text):
                result = result + Text(verbatim: text)
            case .math(let tex):
                result = result + formula(tex)
            }
        }
        return result
    }

    private func formula(_ tex: String) -> Text {
        let renderer = CSCAMathRenderer.shared
        guard var rendered = renderer.render(tex, fontSize: mathSize, display: false) else {
            return Text(verbatim: tex)
        }
        let width = rendered.image.size.width
        let limit = formulaLimit
        if limit.isFinite, limit > 0, width > limit {
            let scaled = max(mathSize * 0.55, mathSize * (limit - 2) / width)
            if let smaller = renderer.render(tex, fontSize: scaled, display: false) {
                rendered = smaller
            }
        }
        return Text(Image(uiImage: rendered.image).renderingMode(.template))
            .baselineOffset(-rendered.baselineFromBottom)
    }

    private var accessibilityText: Text {
        var attributed = AttributedString()
        for segment in CSCATeX.segments(source) {
            switch segment {
            case .text(let text):
                var run = AttributedString(text)
                if isEnglish { run.languageIdentifier = "en" }
                attributed += run
            case .math(let tex):
                var run = AttributedString(" " + CSCATeX.spoken(tex) + " ")
                run.languageIdentifier = "en"
                attributed += run
            }
        }
        return Text(attributed)
    }
}

/// One display formula, centred; scrolls sideways when it is wider than
/// the screen even at its natural size.
struct CSCAMathBlock: View {
    let tex: String

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.cscaColumnWidth) private var columnWidth
    @State private var availableWidth: CGFloat = 0

    var body: some View {
        let size = CSCAType.pointSize(.body, dynamicTypeSize) * 1.15
        Group {
            if let rendered = fitted(size) {
                let image = Image(uiImage: rendered.image).renderingMode(.template)
                if availableWidth > 0, rendered.image.size.width > availableWidth + 1 {
                    // Still wider than the line at the smallest size we
                    // allow: scroll sideways instead of clipping.
                    ScrollView(.horizontal, showsIndicators: true) {
                        image
                            .foregroundStyle(.primary)
                            .padding(.vertical, 2)
                    }
                } else {
                    // Resizable with its natural width as the cap: the image
                    // can never push the page wider than the screen.
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .foregroundStyle(.primary)
                        .frame(maxWidth: rendered.image.size.width)
                        .frame(maxWidth: .infinity)
                }
            } else {
                Text(verbatim: tex)
                    .font(.body.monospaced())
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { width in
            if abs(width - availableWidth) > 0.5 { availableWidth = width }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: CSCATeX.spoken(tex)))
    }

    /// Natural size, or smaller (down to 75 %) so the formula fits the line.
    private func fitted(_ size: CGFloat) -> CSCAMathRenderer.Rendered? {
        let renderer = CSCAMathRenderer.shared
        guard let natural = renderer.render(tex, fontSize: size, display: true) else { return nil }
        let limit = min(availableWidth > 0 ? availableWidth : .infinity, columnWidth > 0 ? columnWidth - 16 : .infinity)
        guard limit.isFinite, natural.image.size.width > limit else { return natural }
        let scaled = max(size * 0.75, size * (limit - 2) / natural.image.size.width)
        return renderer.render(tex, fontSize: scaled, display: true) ?? natural
    }
}
