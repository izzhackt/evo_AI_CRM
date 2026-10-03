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
                .tabFade(.home, selected: selectedTab)
                .tabItem { Label("tab_home", systemImage: "house.fill") }
                .tag(PortalTab.home)

            if session.accessTier == .assisted {
                // Статус кейса + «Сообщения» (миграция 200); остальные
                // разделы сопровождения — следующая волна, экран говорит
                // об этом честно.
                MyAdmissionView(session: session)
                    .tabFade(.admission, selected: selectedTab)
                    .tabItem { Label("tab_my_admission", systemImage: "briefcase.fill") }
                .tag(PortalTab.admission)
            }

            UniversitiesView()
                .tabFade(.universities, selected: selectedTab)
                .tabItem { Label("tab_universities", systemImage: "building.columns.fill") }
                .tag(PortalTab.universities)

            if session.accessTier == .approved {
                ProfessionsView()
                    .tabFade(.professions, selected: selectedTab)
                    .tabItem { Label("tab_professions", systemImage: "person.text.rectangle") }
                .tag(PortalTab.professions)
            }

            EnglishView()
                .tabFade(.english, selected: selectedTab)
                .tabItem { Label("tab_english", systemImage: "book.fill") }
                .tag(PortalTab.english)

            ProfileView(session: session, router: router)
                .tabFade(.profile, selected: selectedTab)
                .tabItem { Label("tab_profile", systemImage: "person.crop.circle") }
                .tag(PortalTab.profile)
        }
        .tint(Color("AccentColor"))
        // Tab feedback: a light selection tap plus a 160 ms fade-in of the
        // incoming tab's content (see `tabFade`). The tab bar itself is
        // system-drawn and untouched.
        .sensoryFeedback(.selection, trigger: selectedTab)
    }
}

private extension View {
    /// The selected tab's content fades in over `Motion.fast`; a tab that is
    /// not selected rests at opacity 0 (it is not on screen), so the next
    /// visit starts from 0. No transform, no change under Reduce Motion
    /// other than dropping the fade.
    func tabFade(_ tab: PortalTab, selected: PortalTab) -> some View {
        modifier(TabFade(isSelected: tab == selected))
    }
}

private struct TabFade: ViewModifier {
    let isSelected: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(isSelected || reduceMotion ? 1 : 0)
            .animation(reduceMotion ? nil : Motion.fast, value: isSelected)
    }
}
