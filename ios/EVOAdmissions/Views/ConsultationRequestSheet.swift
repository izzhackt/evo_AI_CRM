import SwiftUI

/// Форма «Записаться на консультацию» (миграция 197): из карточки вуза
/// (с institution_id) или из профиля (без). Отправка идемпотентна по
/// request_id; при уже открытом запросе сервер возвращает ЕГО receipt —
/// экран честно говорит, что новый запрос не создавался (one-open, 197:146-152).
/// ПРИВАТНОСТЬ (план §6/§14): к запросу не прикрепляются результаты тестов —
/// уходит только свободный текст ученика и явно выбранный вуз.
@MainActor
final class ConsultationRequestViewModel: ObservableObject {
    enum SubmitState {
        case idle
        case sending
        /// receipt + признак «это уже существовавший открытый запрос».
        case sent(ConsultationReceipt, alreadyOpen: Bool)
        case failed
    }

    @Published var note = ""
    @Published var state: SubmitState = .idle

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    var canSubmit: Bool {
        if case .sending = state { return false }
        if case .sent = state { return false }
        return note.count <= 500
    }

    func submit(institutionId: UUID?) async {
        guard canSubmit else { return }
        state = .sending
        let requestId = UUID()
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let receipt = try await service.createConsultationRequest(
                requestId: requestId,
                institutionId: institutionId,
                note: trimmed.isEmpty ? nil : trimmed
            )
            state = .sent(receipt, alreadyOpen: receipt.requestId != requestId)
        } catch {
            state = .failed
        }
    }
}

struct ConsultationRequestSheet: View {
    /// Вуз из карточки; nil — запрос из профиля.
    let institutionId: UUID?
    let institutionName: String?

    @StateObject private var model = ConsultationRequestViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("consultation_hint")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if let institutionName {
                        LabeledContent {
                            Text(institutionName)
                        } label: {
                            Text("consultation_university_label")
                        }
                    }
                }

                Section("consultation_note_label") {
                    TextField(
                        "consultation_note_placeholder",
                        text: $model.note,
                        axis: .vertical
                    )
                    .lineLimit(3...6)
                    if model.note.count > 500 {
                        Text("consultation_note_too_long")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    switch model.state {
                    case .idle, .sending:
                        Button {
                            Task { await model.submit(institutionId: institutionId) }
                        } label: {
                            if case .sending = model.state {
                                ProgressView()
                            } else {
                                Text("consultation_submit")
                            }
                        }
                        .disabled(!model.canSubmit)
                    case .sent(let receipt, let alreadyOpen):
                        VStack(alignment: .leading, spacing: 6) {
                            Label(
                                alreadyOpen ? "consultation_already_open" : "consultation_sent",
                                systemImage: "checkmark.circle"
                            )
                            .font(.subheadline)
                            if let date = PostgresTimestamp.dayLabel(
                                from: receipt.requestedAt,
                                locale: AppLocale.current
                            ) {
                                Text(String(
                                    format: String(localized: "consultation_history_date"),
                                    date
                                ))
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            }
                        }
                    case .failed:
                        VStack(alignment: .leading, spacing: 8) {
                            Text("consultation_error")
                                .font(.subheadline)
                                .foregroundStyle(.red)
                            Button("retry_button") {
                                Task { await model.submit(institutionId: institutionId) }
                            }
                        }
                    }
                }
            }
            .navigationTitle("consultation_heading")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if case .sent = model.state {
                        Button("close_button") { dismiss() }
                    } else {
                        Button("cancel_button") { dismiss() }
                    }
                }
            }
        }
    }
}
