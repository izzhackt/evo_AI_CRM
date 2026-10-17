import SwiftUI

/// Чтение для карточки CSCA на «Главной» (Q16). Главная трека читается только
/// после выбора Китая: `update(choice:)` зовут после чтения выбора и при его
/// смене. Сбой чтения не рисует ничего: карточка просто не появляется, а уже
/// показанная не пропадает от неудачного фонового обновления. Ответ, который
/// пришёл после смены страны, отбрасывается.
@MainActor
final class CSCAHomeCardModel: ObservableObject {
    @Published private(set) var home: CSCAHome?
    private var generation = 0
    private var loading = false

    func update(choice: StudentCountryChoice?) async {
        guard CSCAHomeCardPolicy.isVisible(choice) else {
            generation += 1
            loading = false
            home = nil
            return
        }
        // Одно чтение за раз: чтение после выбора и обновление экрана не удваиваются.
        guard !loading else { return }
        loading = true
        generation += 1
        let mine = generation
        do {
            let loaded = try await SupabaseService.shared.cscaHome().value
            if mine == generation { home = loaded }
        } catch {
            // Нет данных: карточки нет (или остаётся прежняя), плашки ошибки нет.
        }
        if mine == generation { loading = false }
    }
}

/// Компактная карточка CSCA в начале блока «Продолжить» (Q16, план v2 §9.1):
/// название, одна строка обзора экзамена, ближайшая официальная сессия со
/// сроком регистрации и одно действие «К подготовке» (экран CSCA открывается
/// в стеке «Главной», «Назад» возвращает на неё). Что показывать и кому,
/// решает `CSCAHomeCardPolicy`; здесь только вид, как у соседних секций.
struct CSCAHomeCardSection: View {
    @ObservedObject var model: CSCAHomeCardModel

    var body: some View {
        if let home = model.home {
            let session = CSCAHomeCardPolicy.nearestSession(in: home)
            Section {
                Group {
                    VStack(alignment: .leading, spacing: 6) {
                        if let summary = CSCAHomeCardPolicy.summary(kyrgyz: AppLocale.isKyrgyz) {
                            Text(verbatim: summary)
                                .font(.subheadline)
                                .foregroundStyle(.secondaryText)
                        }
                        if let session {
                            Text(verbatim: CSCAText.f("csca_home_card_session", CSCASessionCopy.dates(session)))
                                .font(.subheadline)
                                .foregroundStyle(.secondaryText)
                            if let days = CSCAHomeCardPolicy.closesInDays(for: session, in: home) {
                                Text(verbatim: CSCAText.f("csca_home_card_registration", CSCASessionCopy.closesIn(days)))
                                    .font(.subheadline.weight(.semibold))
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    .accessibilityElement(children: .combine)
                    NavigationLink(value: CSCARoute.home) {
                        Text(csca: "csca_home_card_action")
                    }
                    .accessibilityHint(Text(csca: "csca_title"))
                }
                .motionStagger(index: 2, key: "home.csca")
            } header: {
                Text(csca: "csca_title").foregroundStyle(.secondaryText)
            }
        }
    }
}
