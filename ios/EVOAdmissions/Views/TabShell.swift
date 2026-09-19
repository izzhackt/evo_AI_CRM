import SwiftUI

/// Tabs by access tier (docs/design/portal/port-0-contracts.md):
/// approved (`pending` case) = Главная, Университеты, Тесты, Профиль;
/// assisted (`active`/`closed` case) additionally gets Моё поступление.
struct TabShell: View {
    let session: SessionRouter.PortalSession
    @ObservedObject var router: SessionRouter

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

            TestsView()
                .tabItem { Label("tab_tests", systemImage: "checklist") }

            ProfileView(session: session, router: router)
                .tabItem { Label("tab_profile", systemImage: "person.crop.circle") }
        }
        .tint(Color("AccentColor"))
    }
}
