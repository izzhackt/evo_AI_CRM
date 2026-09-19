import SwiftUI

/// Tabs by access tier (docs/design/portal/design-contract.md, «Карта
/// экранов»):
/// - approved: Главная · Университеты · Профессии · Английский · Профиль
/// - assisted: Главная · Моё поступление · Университеты · Английский ·
///   Профиль («Профессии» остаются с Главной)
/// «Тесты» — не вкладка: входы из «Английский»/«Профессии» и личные
/// результаты в Профиле. «Избранное» живёт внутри вкладки «Университеты».
struct TabShell: View {
    let session: SessionRouter.PortalSession
    @ObservedObject var router: SessionRouter

    var body: some View {
        TabView {
            HomeView(session: session)
                .tabItem { Label("tab_home", systemImage: "house.fill") }

            if session.accessTier == .assisted {
                // Статус кейса + «Сообщения» (миграция 200); остальные
                // разделы сопровождения — следующая волна, экран говорит
                // об этом честно.
                MyAdmissionView(session: session)
                    .tabItem { Label("tab_my_admission", systemImage: "briefcase.fill") }
            }

            UniversitiesView()
                .tabItem { Label("tab_universities", systemImage: "building.columns.fill") }

            if session.accessTier == .approved {
                ProfessionsView()
                    .tabItem { Label("tab_professions", systemImage: "person.text.rectangle") }
            }

            EnglishView()
                .tabItem { Label("tab_english", systemImage: "book.fill") }

            ProfileView(session: session, router: router)
                .tabItem { Label("tab_profile", systemImage: "person.crop.circle") }
        }
        .tint(Color("AccentColor"))
    }
}
