import Foundation

/// Reads the Supabase configuration that `project.yml` injects into
/// `Info.plist` from `ios/Local.xcconfig` (see `ios/Local.xcconfig.example`).
///
/// Fails loudly at launch when a value is missing or empty, instead of
/// silently sending requests to an empty host and failing confusingly deep
/// in the network stack.
enum AppConfig {
    static let supabaseURL: URL = {
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
            !raw.isEmpty,
            let url = URL(string: raw)
        else {
            fatalError(configurationErrorMessage(missingKey: "SUPABASE_URL"))
        }
        return url
    }()

    static let supabasePublishableKey: String = {
        guard
            let key = Bundle.main.object(forInfoDictionaryKey: "SUPABASE_PUBLISHABLE_KEY") as? String,
            !key.isEmpty
        else {
            fatalError(configurationErrorMessage(missingKey: "SUPABASE_PUBLISHABLE_KEY"))
        }
        return key
    }()

    /// Base URL of the web cabinet for the two bearer document route
    /// handlers (ADR 0030 §3). Comes from the same place the Supabase config
    /// lives (`ios/Local.xcconfig` → Info.plist via project.yml, key
    /// `PORTAL_WEB_BASE_URL`); a missing/empty value — including a hostless
    /// artefact of xcconfig's `//`-comment truncation (e.g. `https:`) —
    /// falls back to the production cabinet, https://app.evoadmissions.com
    /// (plan §2). Unlike the Supabase keys this is NOT fatal when absent:
    /// the default is a real, correct production value.
    static let portalWebBaseURL: URL = {
        let fallback = URL(string: "https://app.evoadmissions.com")!
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "PORTAL_WEB_BASE_URL") as? String,
            !raw.isEmpty,
            let url = URL(string: raw),
            let scheme = url.scheme,
            scheme == "https" || scheme == "http",
            let host = url.host(), !host.isEmpty
        else {
            return fallback
        }
        return url
    }()

    private static func configurationErrorMessage(missingKey key: String) -> String {
        """
        \(key) is missing or empty in Info.plist.

        Copy ios/Local.xcconfig.example to ios/Local.xcconfig, fill in the \
        real Supabase project URL and publishable key, then run \
        `xcodegen generate` again before building.
        """
    }
}
