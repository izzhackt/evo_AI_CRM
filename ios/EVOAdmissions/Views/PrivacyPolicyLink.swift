import SwiftUI

/// Ссылка «Политика конфиденциальности»: страница сайта в Safari, адрес тот
/// же, что в App Store Connect (`AppLinks.privacyPolicy`). Цвет текста
/// `AccentColor`: 5,37:1 на белом, 7,5:1 на #1C1C1E.
struct PrivacyPolicyLink: View {
    var body: some View {
        Link(destination: AppLinks.privacyPolicy) {
            Label {
                Text("privacy_policy_link")
            } icon: {
                Image(systemName: "arrow.up.right.square")
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44, alignment: .leading)
        }
        .tint(Color("AccentColor"))
        .accessibilityHint(Text("privacy_policy_hint"))
    }
}
