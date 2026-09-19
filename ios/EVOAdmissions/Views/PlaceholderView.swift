import SwiftUI

/// v1 stand-in for tabs with no real content yet — one honest line, no fake
/// data or fabricated screens.
struct PlaceholderView: View {
    let titleKey: LocalizedStringKey

    var body: some View {
        NavigationStack {
            VStack {
                Text("section_in_progress")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(32)
            }
            .navigationTitle(titleKey)
        }
    }
}
