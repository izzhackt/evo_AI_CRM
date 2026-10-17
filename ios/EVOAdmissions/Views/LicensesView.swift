import SwiftUI
import UIKit

/// «Лицензии»: уведомления всех сторонних компонентов сборки (review #1215
/// App Store, M3). Вход из «Профиля» и из подвала главной CSCA. Юридические
/// тексты на языке оригинала (английском), подписи экрана на языке
/// интерфейса.
struct LicensesView: View {
    var body: some View {
        List {
            Section {
                ForEach(ThirdPartyNotices.packages) { notice in
                    row(notice)
                }
            } header: {
                Text("licenses_libraries_heading")
            } footer: {
                Text("licenses_original_language_note")
                    .foregroundStyle(.secondaryText)
            }
            Section {
                Text(verbatim: ThirdPartyNotices.fontSummary)
                    .font(.footnote)
                    .environment(\.locale, Locale(identifier: "en"))
                ForEach(ThirdPartyNotices.fonts) { notice in
                    row(notice)
                }
            } header: {
                Text("licenses_fonts_heading")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(Text("licenses_title"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ notice: ThirdPartyNotice) -> some View {
        NavigationLink {
            LicenseTextScreen(notice: notice)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: notice.name)
                Text(verbatim: [notice.version, notice.license].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote)
                    .foregroundStyle(.secondaryText)
            }
            .padding(.vertical, 2)
        }
    }
}

/// Полный текст лицензии (и NOTICE) одного компонента.
private struct LicenseTextScreen: View {
    let notice: ThirdPartyNotice

    var body: some View {
        Group {
            if let text = ThirdPartyNotices.text(of: notice) {
                LicenseTextView(text: notice.url + "\n\n" + text)
                    .ignoresSafeArea(edges: .bottom)
            } else {
                // Файл лицензии входит в бандл всегда (тест проверяет каждый);
                // этот путь только на случай повреждённой установки.
                Text("licenses_text_unavailable")
                    .foregroundStyle(.secondaryText)
                    .padding()
            }
        }
        .navigationTitle(Text(verbatim: notice.name))
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// Длинный текст в `UITextView`: прокрутка, выделение и Dynamic Type
/// системные, высоту не меряет SwiftUI `Text` (на iOS 26 он обрезал
/// длинные абзацы, см. `AtlasParagraph`).
private struct LicenseTextView: UIViewRepresentable {
    let text: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.dataDetectorTypes = [.link]
        view.adjustsFontForContentSizeCategory = true
        view.font = .preferredFont(forTextStyle: .footnote)
        view.textColor = .label
        view.backgroundColor = .systemBackground
        view.textContainerInset = UIEdgeInsets(top: 16, left: 12, bottom: 32, right: 12)
        view.alwaysBounceVertical = true
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
    }
}
