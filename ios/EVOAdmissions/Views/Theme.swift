import SwiftUI

/// Семантические цвета текста (аудит UX/UI 2026-10, часть iPhone).
///
/// Системный `.secondary` даёт 3,3..3,4:1 на белом и на `#F2F2F7`, а красный
/// акцент на собственной розовой заливке `.bordered` даёт 3,85:1; норма WCAG AA
/// для обычного текста 4,5:1. У каждого цвета в каталоге есть варианты для
/// тёмной темы и для «Увеличения контраста». Расчёт контраста по относительной
/// яркости WCAG 2.x:
/// - `SecondaryText` #636366 / #AEAEB2: 5,99:1 на белом, 5,37:1 на #F2F2F7,
///   7,69:1 на #1C1C1E, 5,13:1 на #3A3A3C.
/// - `AccentColor` #D70217 / #FF8A8A: 5,37:1 на белом, 7,5:1 на #1C1C1E,
///   4,79:1 на подложке выбранной вкладки rgb(61,61,61).
/// - `AccentText` #B00016 / #FF8A8A: 5,19:1 на своей заливке 18% в светлой
///   теме, 5,38:1 в тёмной.
/// - `AccentFill` #D70217 в обеих темах: белый текст 5,37:1. Вариант
///   `AccentColor` для тёмной темы под заливку не годится: белый на #FF8A8A
///   2,27:1.
/// - `DangerText` #C00018 / #FF7A7A: 6,45:1 на белом, 6,74:1 на #1C1C1E.
extension ShapeStyle where Self == Color {
    /// Вторичный текст: подписи, даты, пояснения, заголовки секций.
    static var secondaryText: Color { Color("SecondaryText") }
    /// Текст акцентного цвета на тонированной заливке (кнопки `.bordered`).
    static var accentText: Color { Color("AccentText") }
    /// Заливка под белым текстом (кнопки `.borderedProminent`).
    static var accentFill: Color { Color("AccentFill") }
    /// Текст ошибок и разрушительных действий.
    static var dangerText: Color { Color("DangerText") }
}

extension View {
    /// `.bordered` с акцентом, который проходит 4,5:1 на своей заливке.
    func accentBordered() -> some View {
        buttonStyle(.bordered).tint(.accentText)
    }

    /// `.borderedProminent` с заливкой, на которой белый текст проходит 4,5:1
    /// и в тёмной теме.
    func accentProminent() -> some View {
        buttonStyle(.borderedProminent).tint(.accentFill)
    }
}

/// Метка статуса: цвет живёт в заливке и значке, текст основным цветом.
/// Раньше текст был того же цвета, что заливка 12%, и давал 2,0..3,3:1.
struct StatusBadge: View {
    enum Tone {
        case success, warning, danger, info, neutral

        var fill: Color {
            switch self {
            case .success: return .green
            case .warning: return .orange
            case .danger: return .red
            case .info: return .blue
            case .neutral: return .gray
            }
        }
    }

    let title: Text
    let systemImage: String
    let tone: Tone

    init(_ title: Text, systemImage: String, tone: Tone) {
        self.title = title
        self.systemImage = systemImage
        self.tone = tone
    }

    var body: some View {
        // HStack, а не Label: в строке списка Label выравнивает значок по
        // колонке значков и раздвигает метку.
        HStack(spacing: 4) {
            Image(systemName: systemImage)
                .imageScale(.small)
                .accessibilityHidden(true)
            title
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(.primary)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(tone.fill.opacity(0.18), in: Capsule())
    }
}
