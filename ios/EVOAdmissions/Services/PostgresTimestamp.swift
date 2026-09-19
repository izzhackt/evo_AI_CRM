import Foundation

/// Parses timestamptz strings that Postgres renders inside JSONB payloads
/// (`jsonb_build_object(..., clock_timestamp())` in migrations 135/148):
/// `2026-09-19T10:23:54.123456+00:00`, with any fractional-second length,
/// `Z`, or no fraction at all. `ISO8601DateFormatter` alone is unreliable for
/// microsecond fractions, so the fraction is stripped before parsing —
/// second precision is enough for every display use here.
enum PostgresTimestamp {
    static func date(from raw: String) -> Date? {
        var normalized = raw
        if let dotIndex = normalized.firstIndex(of: ".") {
            var end = normalized.index(after: dotIndex)
            while end < normalized.endIndex, normalized[end].isNumber {
                end = normalized.index(after: end)
            }
            normalized.removeSubrange(dotIndex..<end)
        }
        // Postgres can emit a space instead of T when cast via ::text paths.
        normalized = normalized.replacingOccurrences(of: " ", with: "T")
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: normalized)
    }

    /// Localized medium date (with time omitted) for history rows; returns
    /// nil instead of a fabricated date when the payload cannot be parsed.
    static func dayLabel(from raw: String, locale: Locale) -> String? {
        guard let date = date(from: raw) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

/// Formatting for the catalogue's plain-date content fields
/// (`YYYY-MM-DD` / `YYYY-MM` strings validated by migration 148).
enum CatalogDate {
    static func dayLabel(from raw: String, locale: Locale) -> String? {
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.timeZone = TimeZone(identifier: "UTC")
        input.dateFormat = "yyyy-MM-dd"
        guard let date = input.date(from: raw) else { return nil }
        let output = DateFormatter()
        output.locale = locale
        output.timeZone = TimeZone(identifier: "UTC")
        output.dateStyle = .long
        output.timeStyle = .none
        return output.string(from: date)
    }

    static func monthLabel(from raw: String, locale: Locale) -> String? {
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.timeZone = TimeZone(identifier: "UTC")
        input.dateFormat = "yyyy-MM"
        guard let date = input.date(from: raw) else { return nil }
        let output = DateFormatter()
        output.locale = locale
        output.timeZone = TimeZone(identifier: "UTC")
        output.setLocalizedDateFormatFromTemplate("LLLL yyyy")
        return output.string(from: date)
    }
}
