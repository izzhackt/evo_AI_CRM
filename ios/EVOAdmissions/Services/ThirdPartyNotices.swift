import Foundation

/// Уведомления сторонних компонентов, которые входят в сборку (review #1215
/// App Store, M3). MIT требует передать уведомление вместе с программой,
/// Apache 2.0 (раздел 4, пункты a и d) ещё и текст лицензии с файлом NOTICE.
///
/// Список сверяется тестом `ThirdPartyNoticesTests` с пинами
/// `Package.resolved`: каждая зависимость с её версией, без пропусков и
/// лишних. В список входит и swift-asn1, хотя сейчас он в бинарник не
/// попадает: уведомление лишним не бывает, а при смене зависимостей
/// supabase-swift список не устареет молча. Тексты лежат в
/// `Resources/Licenses` копиями файлов пакетов на закреплённых ревизиях (без
/// концевых пробелов) и показываются на языке оригинала.
struct ThirdPartyNotice: Identifiable, Equatable {
    /// `identity` пина в `Package.resolved` или `nil` для шрифтов.
    let identity: String?
    let name: String
    let version: String?
    let license: String
    let url: String
    /// Имена файлов в бандле без расширения `.txt`, по порядку показа.
    let files: [String]

    var id: String { identity ?? name }
}

enum ThirdPartyNotices {
    static let packages: [ThirdPartyNotice] = [
        ThirdPartyNotice(
            identity: "supabase-swift", name: "supabase-swift", version: "2.55.2", license: "MIT",
            url: "https://github.com/supabase/supabase-swift", files: ["license-supabase-swift"]
        ),
        ThirdPartyNotice(
            identity: "swift-crypto", name: "swift-crypto", version: "4.5.2", license: "Apache 2.0",
            url: "https://github.com/apple/swift-crypto", files: ["license-swift-crypto", "notice-swift-crypto"]
        ),
        ThirdPartyNotice(
            identity: "swift-http-types", name: "swift-http-types", version: "1.8.0", license: "Apache 2.0",
            url: "https://github.com/apple/swift-http-types", files: ["license-swift-http-types", "notice-swift-http-types"]
        ),
        ThirdPartyNotice(
            identity: "swift-asn1", name: "swift-asn1", version: "1.7.3", license: "Apache 2.0",
            url: "https://github.com/apple/swift-asn1", files: ["license-swift-asn1", "notice-swift-asn1"]
        ),
        ThirdPartyNotice(
            identity: "swift-clocks", name: "swift-clocks", version: "1.1.1", license: "MIT",
            url: "https://github.com/pointfreeco/swift-clocks", files: ["license-swift-clocks"]
        ),
        ThirdPartyNotice(
            identity: "swift-concurrency-extras", name: "swift-concurrency-extras", version: "1.4.1", license: "MIT",
            url: "https://github.com/pointfreeco/swift-concurrency-extras", files: ["license-swift-concurrency-extras"]
        ),
        ThirdPartyNotice(
            identity: "xctest-dynamic-overlay", name: "xctest-dynamic-overlay (IssueReporting)", version: "1.13.1",
            license: "MIT", url: "https://github.com/pointfreeco/xctest-dynamic-overlay",
            files: ["license-xctest-dynamic-overlay"]
        ),
        ThirdPartyNotice(
            identity: "swiftmath", name: "SwiftMath (iosMath)", version: "1.7.3", license: "MIT",
            url: "https://github.com/mgriebling/SwiftMath", files: ["license-swiftmath", "license-iosmath"]
        ),
    ]

    /// Лицензии шрифтов формул из бандла SwiftMath (сами тексты пакета).
    static let fonts: [ThirdPartyNotice] = [
        ThirdPartyNotice(
            identity: nil, name: "GUST Font License", version: nil, license: "LPPL 1.3c",
            url: "https://www.gust.org.pl/fonts/licenses", files: ["license-font-gust"]
        ),
        ThirdPartyNotice(
            identity: nil, name: "STIX Font License (SIL OFL 1.1)", version: nil, license: "OFL 1.1",
            url: "https://openfontlicense.org", files: ["license-font-stix-ofl"]
        ),
    ]

    /// Шрифты пакета SwiftMath и их лицензии (12 файлов `.otf` в бандле).
    static let fontSummary = """
    Formulas use Latin Modern Math (GUST e-foundry, GUST Font License, \
    LaTeX Project Public License 1.3c). SwiftMath also bundles TeX Gyre Termes \
    Math (GUST Font License), XITS Math (STIX font license terms), and Asana \
    Math, Euler Math, Fira Math, Garamond Math, KpMath Light, KpMath Sans, \
    Lete Sans Math, Libertinus Math and Noto Sans Math (SIL Open Font License \
    1.1).
    """

    /// Текст уведомления для экрана: файлы по порядку, абзацы через пустую
    /// строку, строки внутри абзаца склеены (`reflow`).
    static func text(of notice: ThirdPartyNotice, in bundle: Bundle = .main) -> String? {
        let parts = notice.files.compactMap { name -> String? in
            guard let url = bundle.url(forResource: name, withExtension: "txt") else { return nil }
            return try? String(contentsOf: url, encoding: .utf8)
        }
        guard parts.count == notice.files.count else { return nil }
        return parts.map(reflow).joined(separator: "\n\n\n")
    }

    /// Файлы лицензий свёрстаны жёстким переносом на 80 знаков; на ширине
    /// телефона такие строки рвутся посередине. Внутри абзаца строки
    /// склеиваются пробелом, кроме строк-пунктов (`* `), строк комментария
    /// (`%`) и линеек из `=`, `-`, `_`. Слова и их порядок не меняются
    /// (`ThirdPartyNoticesTests`).
    static func reflow(_ text: String) -> String {
        let paragraphs = text.components(separatedBy: "\n")
            .split { $0.trimmingCharacters(in: .whitespaces).isEmpty }
        return paragraphs.map { lines -> String in
            var out = ""
            var previousKeeps = false
            for raw in lines {
                let line = raw.trimmingCharacters(in: .whitespaces)
                let keeps = keepsOwnLine(line)
                // Пункт списка сохраняет свой отступ (вложенность в NOTICE).
                let shown = line.hasPrefix("* ") ? String(raw.prefix { $0 == " " }) + line : line
                if out.isEmpty {
                    out = shown
                } else if keeps || previousKeeps {
                    out += "\n" + shown
                } else {
                    out += " " + shown
                }
                previousKeeps = keeps
            }
            return out
        }.joined(separator: "\n\n")
    }

    private static func keepsOwnLine(_ line: String) -> Bool {
        line.hasPrefix("* ") || line.hasPrefix("%") || line.allSatisfy { "=-_".contains($0) }
    }
}

/// Адрес политики конфиденциальности: тот же, что в поле «Privacy Policy
/// URL» App Store Connect (`ios/docs/app-store/listing-ru.md`, проверяется
/// тестом). Правило App Store 5.1.1(i): ссылка и в метаданных, и в
/// приложении. Страницу публикует сайт (PR izzhackt/evoadmissions-website#26).
enum AppLinks {
    static let privacyPolicy = URL(string: "https://evoadmissions.com/ru/privacy/")!
}
