import SwiftUI

/// Parsed figures cached by the content checksum (contract §15 allows it).
@MainActor
final class CSCAFigureCache {
    static let shared = CSCAFigureCache()

    private var documents: [String: CSCASVGDocument] = [:]
    private var rejected: Set<String> = []

    func document(for figure: CSCAFigure) -> CSCASVGDocument? {
        if let hit = documents[figure.sha256] { return hit }
        if rejected.contains(figure.sha256) { return nil }
        do {
            let document = try CSCASVGParser.parse(figure.svg)
            documents[figure.sha256] = document
            return document
        } catch {
            rejected.insert(figure.sha256)
            return nil
        }
    }
}

/// A CSCA figure drawn natively from its SVG (strict profile): vector
/// shapes and text in SwiftUI Canvas, the six palette colours swapped one to
/// one in dark mode. Height comes from the viewBox, so nothing jumps while
/// a lesson scrolls. A figure outside the profile shows its alt text.
struct CSCAFigureView: View {
    let figure: CSCAFigure
    var allowsZoom = true

    @Environment(\.colorScheme) private var colorScheme
    @State private var showsZoom = false

    private var alt: String { AppLocale.pick(ru: figure.altRu, ky: figure.altKy) }

    var body: some View {
        if let document = CSCAFigureCache.shared.document(for: figure) {
            canvas(document)
                .contentShape(Rectangle())
                .onTapGesture { if allowsZoom { showsZoom = true } }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: alt))
                .accessibilityAddTraits(allowsZoom ? [.isImage, .isButton] : .isImage)
                .accessibilityHint(allowsZoom ? Text(csca: "csca_figure_zoom_hint") : Text(verbatim: ""))
                .sheet(isPresented: $showsZoom) {
                    CSCAFigureZoomView(figure: figure, document: document)
                }
        } else {
            Text(verbatim: alt)
                .font(.callout)
                .foregroundStyle(CSCAColor.secondaryText)
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(CSCAColor.panel, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    func canvas(_ document: CSCASVGDocument) -> some View {
        CSCAFigureCanvas(document: document, dark: colorScheme == .dark)
            .aspectRatio(document.aspectRatio, contentMode: .fit)
            .frame(maxWidth: .infinity)
    }
}

struct CSCAFigureCanvas: View {
    let document: CSCASVGDocument
    let dark: Bool

    var body: some View {
        Canvas { context, size in
            let scale = size.width / document.width
            context.scaleBy(x: scale, y: scale)
            for node in document.nodes {
                switch node {
                case .shape(let shape): draw(shape, in: context)
                case .text(let text): draw(text, in: context)
                }
            }
        }
    }

    private func color(_ paint: CSCASVGPaint, opacity: Double) -> Color? {
        guard case .role(let role) = paint else { return nil }
        return CSCAColor.figure(role, dark: dark).opacity(opacity)
    }

    private func draw(_ shape: CSCASVGShape, in parent: GraphicsContext) {
        var context = parent
        context.concatenate(shape.transform)
        let path = Path(shape.path)
        let style = shape.style
        if let fill = color(style.resolvedFill, opacity: shape.opacity * (style.fillOpacity ?? 1)) {
            context.fill(path, with: .color(fill))
        }
        if let stroke = color(style.resolvedStroke, opacity: shape.opacity * (style.strokeOpacity ?? 1)) {
            let cap: CGLineCap = {
                switch style.lineCap ?? .butt {
                case .butt: return .butt
                case .round: return .round
                case .square: return .square
                }
            }()
            let join: CGLineJoin = {
                switch style.lineJoin ?? .miter {
                case .miter: return .miter
                case .round: return .round
                case .bevel: return .bevel
                }
            }()
            context.stroke(path, with: .color(stroke), style: StrokeStyle(
                lineWidth: style.resolvedStrokeWidth,
                lineCap: cap,
                lineJoin: join,
                dash: (style.dash ?? []).map { CGFloat($0) }
            ))
        }
    }

    private func draw(_ text: CSCASVGText, in parent: GraphicsContext) {
        var context = parent
        context.concatenate(text.transform)
        struct Piece {
            let resolved: GraphicsContext.ResolvedText
            let width: CGFloat
            let baseline: CGFloat
            let dx: CGFloat
            let dy: CGFloat
        }
        var pieces: [Piece] = []
        for run in text.runs {
            let style = run.style
            var font = Font.system(size: style.resolvedFontSize, weight: style.bold == true ? .semibold : .regular)
            if style.italic == true { font = font.italic() }
            let fill = color(style.resolvedFill, opacity: text.opacity * (style.fillOpacity ?? 1)) ?? .clear
            // Spaces become no-break spaces so leading and trailing ones keep
            // their width when measured.
            let visible = run.text.replacingOccurrences(of: " ", with: "\u{00A0}")
            let resolved = context.resolve(Text(verbatim: visible).font(font).foregroundColor(fill))
            let measured = run.text.isEmpty ? .zero : resolved.measure(in: CGSize(width: CGFloat.infinity, height: .infinity))
            pieces.append(Piece(
                resolved: resolved,
                width: measured.width,
                baseline: run.text.isEmpty ? 0 : resolved.firstBaseline(in: measured),
                dx: run.dx, dy: run.dy
            ))
        }
        let total = pieces.reduce(0) { $0 + $1.width + $1.dx }
        var x: CGFloat = text.x
        switch text.style.anchor ?? .start {
        case .start: break
        case .middle: x -= total / 2
        case .end: x -= total
        }
        var y: CGFloat = text.y
        let size = text.style.resolvedFontSize
        switch text.style.baseline {
        case "middle", "central": y += size * 0.35
        case "hanging": y += size * 0.75
        default: break
        }
        for (piece, run) in zip(pieces, text.runs) {
            x += piece.dx
            y += piece.dy
            if !run.text.isEmpty {
                context.draw(piece.resolved, at: CGPoint(x: x, y: y - piece.baseline), anchor: .topLeading)
            }
            x += piece.width
        }
    }
}

/// Larger view of a figure: twice the screen width, scrollable both ways.
struct CSCAFigureZoomView: View {
    let figure: CSCAFigure
    let document: CSCASVGDocument

    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        NavigationStack {
            GeometryReader { proxy in
                ScrollView([.horizontal, .vertical]) {
                    CSCAFigureCanvas(document: document, dark: colorScheme == .dark)
                        .frame(width: proxy.size.width * 2, height: proxy.size.width * 2 / document.aspectRatio)
                        .padding(16)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(Text(verbatim: AppLocale.pick(ru: figure.altRu, ky: figure.altKy)))
                        .accessibilityAddTraits(.isImage)
                }
            }
            .background(CSCAColor.page)
            .navigationTitle(Text(csca: "csca_figure_zoom_title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { dismiss() } label: { Text(csca: "csca_done") }
                }
            }
        }
    }
}
