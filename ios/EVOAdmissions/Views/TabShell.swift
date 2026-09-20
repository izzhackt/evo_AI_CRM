import SwiftUI

/// Tabs by access tier (docs/design/portal/design-contract.md, «Карта
/// экранов»):
/// - approved: Главная · Университеты · Профессии · Английский · Профиль
/// - assisted: Главная · Моё поступление · Университеты · Английский ·
///   Профиль («Профессии» остаются с Главной)
/// «Тесты» — не вкладка: входы из «Английский»/«Профессии» и личные
/// результаты в Профиле. «Избранное» живёт внутри вкладки «Университеты».
enum PortalTab: Hashable { case home, admission, universities, professions, english, profile }

struct TabShell: View {
    let session: SessionRouter.PortalSession
    @ObservedObject var router: SessionRouter

    @State private var selectedTab: PortalTab = .home

    var body: some View {
        TabView(selection: $selectedTab) {
            HomeView(session: session, router: router, selectedTab: $selectedTab)
                .tabItem { Label("tab_home", systemImage: "house.fill") }
                .tag(PortalTab.home)

            if session.accessTier == .assisted {
                // Статус кейса + «Сообщения» (миграция 200); остальные
                // разделы сопровождения — следующая волна, экран говорит
                // об этом честно.
                MyAdmissionView(session: session)
                    .tabItem { Label("tab_my_admission", systemImage: "briefcase.fill") }
                .tag(PortalTab.admission)
            }

            UniversitiesView()
                .tabItem { Label("tab_universities", systemImage: "building.columns.fill") }
                .tag(PortalTab.universities)

            if session.accessTier == .approved {
                ProfessionsView()
                    .tabItem { Label("tab_professions", systemImage: "person.text.rectangle") }
                .tag(PortalTab.professions)
            }

            EnglishView()
                .tabItem { Label("tab_english", systemImage: "book.fill") }
                .tag(PortalTab.english)

            ProfileView(session: session, router: router)
                .tabItem { Label("tab_profile", systemImage: "person.crop.circle") }
                .tag(PortalTab.profile)
        }
        .tint(Color("AccentColor"))
    }
}
