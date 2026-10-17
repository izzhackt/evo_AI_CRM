import SwiftUI

/// Renderers of the typed theory blocks (contract §13). A lesson reads like
/// a short chapter: ideas are plain paragraphs, formulas stand on their own
/// lines, a figure sits next to the idea it explains, worked examples open
/// step by step. Unknown block kinds are skipped.
struct CSCATheoryBlockView: View {
    let block: CSCATheoryBlock
    let figures: [String: CSCAFigure]

    var body: some View {
        switch block {
        case .idea(let text):
            CSCAMathText(source: CSCAText.pick(text))
        case .formula(let tex, let note):
            VStack(alignment: .leading, spacing: 10) {
                VStack(spacing: 6) {
                    ForEach(Array(tex.enumerated()), id: \.offset) { _, line in
                        CSCAMathBlock(tex: line)
                    }
                }
                .padding(.vertical, 12)
                .padding(.horizontal, 8)
                .frame(maxWidth: .infinity)
                .background(CSCAColor.panel, in: RoundedRectangle(cornerRadius: 12))
                CSCAMathText(source: CSCAText.pick(note), style: .subheadline)
                    .foregroundStyle(CSCAColor.secondaryText)
            }
        case .figure(let key, let caption), .interactive(_, let key, let caption):
            CSCAFigureBlock(figure: figures[key], caption: caption)
        case .table(let caption, let header, let rows):
            CSCATableBlock(caption: caption, header: header, rows: rows)
        case .example(let title, let stemEn, let steps, let answer):
            CSCAExampleBlock(title: title, stemEn: stemEn, steps: steps, answer: answer)
        case .pitfalls(let items):
            VStack(alignment: .leading, spacing: 10) {
                Text(csca: "csca_pitfalls")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.subheadline)
                            .foregroundStyle(CSCAColor.danger)
                            .accessibilityHidden(true)
                        CSCAMathText(source: CSCAText.pick(item))
                    }
                }
            }
        case .tip(_, let text):
            VStack(alignment: .leading, spacing: 8) {
                Label {
                    Text(csca: "csca_tip_no_calculator")
                } icon: {
                    Image(systemName: "pencil.and.scribble")
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(CSCAColor.accentText)
                CSCAMathText(source: CSCAText.pick(text), style: .callout)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(CSCAColor.panel, in: RoundedRectangle(cornerRadius: 12))
        case .terms(let terms):
            CSCATermsList(terms: terms)
        case .unknown:
            EmptyView()
        }
    }
}

private struct CSCAFigureBlock: View {
    let figure: CSCAFigure?
    let caption: CSCABilingual

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let figure {
                CSCAFigureView(figure: figure)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            CSCAMathText(source: CSCAText.pick(caption), style: .footnote)
                .foregroundStyle(CSCAColor.secondaryText)
        }
    }
}

private struct CSCATableBlock: View {
    let caption: CSCABilingual
    let header: [CSCATableCell]
    let rows: [[CSCATableCell]]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            CSCAMathText(source: CSCAText.pick(caption), style: .subheadline, weight: .semibold)
            ViewThatFits(in: .horizontal) {
                grid
                ScrollView(.horizontal) { grid.fixedSize(horizontal: true, vertical: false) }
            }
        }
    }

    private var grid: some View {
        Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                    cellView(cell, isHeader: true)
                }
            }
            .padding(.vertical, 8)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Divider().gridCellUnsizedAxes(.horizontal)
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                        cellView(cell, isHeader: false)
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .padding(.horizontal, 12)
        .background(CSCAColor.panel, in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private func cellView(_ cell: CSCATableCell, isHeader: Bool) -> some View {
        switch cell {
        case .tex(let tex):
            CSCAMathText(source: "$" + tex + "$", style: .callout)
                .fixedSize()
        case .text(let pair):
            CSCAMathText(source: CSCAText.pick(pair), style: .callout, weight: isHeader ? .semibold : .regular)
                .frame(minWidth: 72, alignment: .leading)
                .accessibilityAddTraits(isHeader ? .isHeader : [])
        }
    }
}

/// Worked example: English statement, then steps one by one.
private struct CSCAExampleBlock: View {
    let title: CSCABilingual
    let stemEn: String
    let steps: [CSCABilingual]
    let answer: CSCABilingual

    @State private var shown = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(verbatim: CSCAText.pick(title))
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            CSCAMathText(source: stemEn, weight: .medium, isEnglish: true)
                .environment(\.locale, Locale(identifier: "en"))
            ForEach(Array(steps.prefix(shown).enumerated()), id: \.offset) { index, step in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(verbatim: "\(index + 1).")
                        .font(.body.monospacedDigit())
                        .foregroundStyle(CSCAColor.secondaryText)
                        .accessibilityHidden(true)
                    CSCAMathText(source: CSCAText.pick(step))
                }
                .transition(.opacity)
            }
            if shown >= steps.count {
                CSCAMathText(source: CSCAText.f("csca_example_answer", CSCAText.pick(answer)), weight: .semibold)
                    .transition(.opacity)
            } else {
                CSCAStepButtons {
                    withAnimation(Motion.base) { shown += 1 }
                } all: {
                    withAnimation(Motion.base) { shown = steps.count }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(CSCAColor.panel, in: RoundedRectangle(cornerRadius: 14))
    }
}
