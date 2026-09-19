import SwiftUI

struct HomeView: View {
    let session: SessionRouter.PortalSession

    private var statusKey: LocalizedStringKey {
        switch session.portalCase.caseState {
        case "pending": return "case_status_pending"
        case "active": return "case_status_active"
        case "closed": return "case_status_closed"
        default: return "case_status_unknown"
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(session.authority.displayName)
                        .font(.largeTitle.bold())

                    VStack(alignment: .leading, spacing: 6) {
                        Text("home_case_status_label")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(statusKey)
                            .font(.title3.weight(.semibold))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))

                    if let nextAction = session.portalCase.nextAction, !nextAction.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("home_next_action_label")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(nextAction)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
                    }

                    // Раздел «Избранное» (195) — вход с Главной.
                    NavigationLink {
                        FavoritesView()
                    } label: {
                        Label("favorites_title", systemImage: "heart")
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)

                    if session.accessTier == .assisted {
                        // У assisted «Профессии» не в таб-баре — вход с
                        // Главной (дизайн-контракт «Карта экранов»).
                        NavigationLink {
                            ProfessionsContentView()
                        } label: {
                            Label("tab_professions", systemImage: "person.text.rectangle")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(16)
                                .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(20)
            }
            .navigationTitle("tab_home")
        }
    }
}
