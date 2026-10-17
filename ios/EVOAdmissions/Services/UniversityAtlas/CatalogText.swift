import Foundation

/// Тексты и ссылки каталога «Университеты v2» (миграция 283): то же правило,
/// что `platform_private.catalog_text_ok` и `catalog_url_ok` в базе и
/// `src/lib/catalog-text.ts` у веба (контракт 2.2a, review раунда 3, F2 и
/// F12). Строки классов знаков ниже записаны теми же символами, что в
/// `catalog-text.ts`; тест `CatalogTextTests` сверяет их с этим файлом и
/// прогоняет общие векторы `tests/fixtures/catalog-text-vectors.json` (те же,
/// что проверяют SQL-набор 283 и `tests/catalog-text.test.mjs`).
///
/// Текст: от 1 до max знаков Unicode (кодовых точек, как `char_length`, а не
/// графем Swift), ни одного знака запрещённого класса и ни одного пробела из
/// `edgeSpaceClass` в начале и в конце. Внутри текста обычный и неразрывный
/// пробелы допустимы. `trimmingCharacters(in: .whitespacesAndNewlines)` и
/// `String.count` здесь не годятся: они не совпадают ни с базой, ни с вебом.
///
/// Ссылка: правило 148 (https, публичный хост, без порта, учётных данных,
/// фрагмента и секретов в запросе) и сверх него ни одного запрещённого знака,
/// ни одного пробела из списка и ни одного знака вне BMP.
enum CatalogText {
    /// `CATALOG_TEXT_FORBIDDEN_SQL`: управляющие C0 (с табуляцией и
    /// переводами строк), DEL и C1, мягкий перенос, знак арабского письма,
    /// монгольский разделитель, знаки нулевой ширины и направления письма,
    /// разделители строк и абзацев, невидимые операторы, BOM, знаки аннотаций.
    static let forbiddenClass = "\\u0001-\\u001F\\u007F-\\u009F\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u2028-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFEFF\\uFFF9-\\uFFFB"

    /// `CATALOG_EDGE_SPACE_SQL`: пробелы, недопустимые в начале и в конце
    /// текста и в любом месте ссылки.
    static let edgeSpaceClass = "\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000"

    /// `CATALOG_ASTRAL_SQL`: знаки вне BMP (в ссылке недопустимы).
    static let astralClass = "\\U00010000-\\U0010FFFF"

    /// `CATALOG_AGENCY_DOMAINS`: домены образовательных агентств и похожих
    /// порталов (review CRM R4). Фото с них не берём (CHECK 283).
    static let agencyDomains = [
        "eduprchina.com", "easyuni.my", "easyuni.com", "applyforchina.com", "directlyeducation.com",
        "cucas.cn", "cucas.edu.cn", "china-admissions.com", "chinaadmissions.com", "studyinchina.io",
        "studyinchina.net", "universitiesofchina.com", "englishpath.com",
    ]

    /// `CATALOG_PHOTO_SOURCE_HOSTS`: источник фото стран и городов и хосты
    /// его адреса (CHECK 283, контракт 2.5).
    static let photoSourceHosts: [String: Set<String>] = [
        "Unsplash": ["unsplash.com", "www.unsplash.com"],
        "Pexels": ["pexels.com", "www.pexels.com"],
        "Wikimedia Commons": ["commons.wikimedia.org", "upload.wikimedia.org"],
    ]

    // В Swift ещё U+0000 (в тексте Postgres его не бывает); одиночных
    // суррогатов в `String` нет.
    private static let forbidden = ranges(forbiddenClass) + [0x0...0x0]
    private static let edgeSpace = ranges(edgeSpaceClass)
    private static let astral = ranges(astralClass)

    static func isForbidden(_ scalar: Unicode.Scalar) -> Bool {
        forbidden.contains { $0.contains(scalar.value) }
    }

    static func isEdgeSpace(_ scalar: Unicode.Scalar) -> Bool {
        edgeSpace.contains { $0.contains(scalar.value) }
    }

    /// Текст для студента: то же, что `catalog_text_ok(value, max)`.
    static func text(_ value: String, max: Int) -> Bool {
        let scalars = value.unicodeScalars
        guard let first = scalars.first, let last = scalars.last else { return false }
        if isEdgeSpace(first) || isEdgeSpace(last) { return false }
        var count = 0
        for scalar in scalars {
            if isForbidden(scalar) { return false }
            count += 1
            if count > max { return false }
        }
        return true
    }

    /// Ссылка каталога: то же, что `catalog_url_ok(value)`.
    static func url(_ value: String) -> Bool {
        // Знаков вне BMP нет, поэтому длина в UTF-16 (как `value.length`
        // веба) равна числу кодовых точек.
        guard value.utf16.count <= 1000 else { return false }
        for scalar in value.unicodeScalars where isForbidden(scalar) || isEdgeSpace(scalar) || astral.contains(where: { $0.contains(scalar.value) }) {
            return false
        }
        guard matches(publicURL, value) else { return false }
        let lower = value.lowercased()
        return !matches(privateHost, lower) && !matches(percentKey, value) && !matches(secretKey, lower)
    }

    /// Хост ссылки так, как его берёт база:
    /// `lower(substring(url FROM '^https://([^/?#]+)'))`.
    static func host(_ value: String) -> String? {
        guard value.hasPrefix("https://") else { return nil }
        let rest = value.dropFirst("https://".count)
        let host = rest.prefix { $0 != "/" && $0 != "?" && $0 != "#" }
        return host.isEmpty ? nil : host.lowercased()
    }

    /// Хост адреса фото принадлежит именно названному источнику.
    static func photoSourceMatches(sourceName: String, sourceUrl: String) -> Bool {
        guard let hosts = photoSourceHosts[sourceName], let host = host(sourceUrl) else { return false }
        return hosts.contains(host)
    }

    /// Адрес на хосте агентства (`catalog_agency_url`).
    static func agencyUrl(_ value: String) -> Bool {
        guard let host = host(value) else { return false }
        return agencyDomains.contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    // MARK: - Регулярные выражения правила 148 (как в catalog-text.ts)

    // Перевод строки и прочие разделители отвергнуты раньше, поэтому `$`
    // здесь значит конец строки так же, как в JS.
    private static let publicURL = regex("^https://([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}([/?][^#\\\\]*)?$")
    private static let privateHost = regex("\\.(localhost|local|internal|test|invalid|example)([/?]|$)")
    private static let percentKey = regex("[?&][^=&]*%[^=&]*(=|&|$)")
    private static let secretKey = regex("[?&][^=&]*(token|secret|password|auth|api.?key)[^=&]*(=|&|$)")

    private static func regex(_ pattern: String) -> NSRegularExpression {
        // Шаблоны постоянные: ошибка здесь это ошибка сборки, а не данных.
        try! NSRegularExpression(pattern: pattern)
    }

    private static func matches(_ regex: NSRegularExpression, _ value: String) -> Bool {
        regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }

    // MARK: - Разбор строки класса

    /// `\uXXXX`, `\UXXXXXXXX` и диапазоны через `-`, как в строке класса
    /// регулярного выражения Postgres и JS.
    static func ranges(_ spec: String) -> [ClosedRange<UInt32>] {
        var values: [(UInt32, Bool)] = []
        var index = spec.startIndex
        while index < spec.endIndex {
            if spec[index] == "-" {
                values.append((0, true))
                index = spec.index(after: index)
                continue
            }
            guard spec[index] == "\\" else { preconditionFailure("Unexpected character class \(spec)") }
            let marker = spec[spec.index(after: index)]
            let length = marker == "U" ? 8 : 4
            let start = spec.index(index, offsetBy: 2)
            let end = spec.index(start, offsetBy: length)
            values.append((UInt32(spec[start..<end], radix: 16)!, false))
            index = end
        }
        var result: [ClosedRange<UInt32>] = []
        var position = 0
        while position < values.count {
            let low = values[position].0
            if position + 2 < values.count, values[position + 1].1 {
                result.append(low...values[position + 2].0)
                position += 3
            } else {
                result.append(low...low)
                position += 1
            }
        }
        return result
    }
}
