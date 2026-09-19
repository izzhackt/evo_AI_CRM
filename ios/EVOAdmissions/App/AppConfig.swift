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

    private static func configurationErrorMessage(missingKey key: String) -> String {
        """
        \(key) is missing or empty in Info.plist.

        Copy ios/Local.xcconfig.example to ios/Local.xcconfig, fill in the \
        real Supabase project URL and publishable key, then run \
        `xcodegen generate` again before building.
        """
    }
}
