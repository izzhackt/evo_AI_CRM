import SwiftUI

/// Tabs by access tier (docs/design/portal/port-0-contracts.md):
/// approved (`pending` case) = Главная, Университеты, Английский, Профиль;
/// assisted (`active`/`closed` case) additionally gets Моё поступление.
struct TabShell: View {
    let session: SessionRouter.PortalSession

    var body: some View {
        TabView {
            HomeView(session: session)
                .tabItem { Label("tab_home", systemImage: "house.fill") }

            if session.accessTier == .assisted {
                PlaceholderView(titleKey: "tab_my_admission")
                    .tabItem { Label("tab_my_admission", systemImage: "briefcase.fill") }
            }

            UniversitiesView()
                .tabItem { Label("tab_universities", systemImage: "building.columns.fill") }

            PlaceholderView(titleKey: "tab_english")
                .tabItem { Label("tab_english", systemImage: "textformat.abc") }

            PlaceholderView(titleKey: "tab_profile")
                .tabItem { Label("tab_profile", systemImage: "person.crop.circle") }
        }
        .tint(Color("AccentColor"))
    }
}
