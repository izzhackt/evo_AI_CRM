import SwiftUI
import Supabase

/// «Сообщения» — студенческая сторона per-case чата (миграция 200),
/// зеркально вебу (`src/components/portal/messages/MessagesThread.tsx`):
/// - страницы по 30 before-курсором (200:151-159), в UI — по возрастанию;
/// - умеренный поллинг ПЕРВОЙ страницы (30 с) с дедупликацией по sequenceId:
///   поллинг не трогает уже загруженные ранние страницы;
/// - отправка идемпотентна: request_id стабилен на попытку, ретрай без
///   правки текста шлёт ту же пару (request_id, body) — сервер вернёт
///   исходный receipt (fingerprint 200:80-90); правка текста после ошибки
///   создаёт НОВЫЙ request_id (иначе PT409 по чужому телу);
/// - оптимистичной вставки нет: сообщение появляется только после
///   подтверждённого чтения с сервера — состояния отправки честные;
/// - документ-карточка с NULL label рендерится нейтральной подписью;
///   task-карточки не рендерятся вовсе (контракт §6, 200:168-176).
@MainActor
final class MessagesThreadModel: ObservableObject {
    enum SendState: Equatable {
        case idle
        case sending
        case sent
        case failed
    }

    @Published private(set) var messages: [PortalCaseChatMessage] = []
    @Published private(set) var awaitState = "none"
    @Published private(set) var hasEarlier = false
    @Published private(set) var isLoadingEarlier = false
    @Published private(set) var loadEarlierFailed = false
    @Published private(set) var initialLoadFailed = false
    @Published private(set) var refreshFailed = false
    @Published private(set) var isLoaded = false

    @Published var draft = ""
    @Published private(set) var sendState: SendState = .idle

    private var earlierCursor: Int64?
    /// Стабильный на попытку отправки; новый — после успеха или после правки
    /// текста вслед за ошибкой (веб-семантика request_id).
    private var requestId = UUID()
    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    var canSend: Bool {
        PortalCaseChatPolicy.isSendable(draft: draft, isSending: sendState == .sending)
    }

    // MARK: - Loading

    func loadInitial() async {
        initialLoadFailed = false
        do {
            let page = try await service.portalCaseChatPage(beforeSequenceId: nil)
            messages = PortalCaseChatPolicy.merge([], page.messages)
            awaitState = page.awaitState
            hasEarlier = page.hasMore
            earlierCursor = Int64(page.cursor)
            isLoaded = true
        } catch {
            initialLoadFailed = true
        }
    }

    /// Поллинг/обновление: только первая страница; ранние страницы и их
    /// курсор не трогаются (веб: refresh() не касается earlierCursor).
    func refreshLatest() async {
        guard isLoaded else { return }
        do {
            let page = try await service.portalCaseChatPage(beforeSequenceId: nil)
            messages = PortalCaseChatPolicy.merge(messages, page.messages)
            awaitState = page.awaitState
            refreshFailed = false
        } catch {
            refreshFailed = true
        }
    }

    func loadEarlier() async {
        guard hasEarlier, !isLoadingEarlier, let cursor = earlierCursor else { return }
        isLoadingEarlier = true
        loadEarlierFailed = false
        do {
            let page = try await service.portalCaseChatPage(beforeSequenceId: cursor)
            messages = PortalCaseChatPolicy.merge(messages, page.messages)
            hasEarlier = page.hasMore
            earlierCursor = Int64(page.cursor)
        } catch {
            loadEarlierFailed = true
        }
        isLoadingEarlier = false
    }

    // MARK: - Sending

    func send() async {
        guard canSend else { return }
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        sendState = .sending
        do {
            _ = try await service.postPortalCaseChatMessage(requestId: requestId, body: body)
            draft = ""
            requestId = UUID()
            sendState = .sent
            // Честное появление: сообщение рендерится после чтения с сервера.
            await refreshLatest()
        } catch {
            sendState = .failed
        }
    }

    /// Правка текста после неудачи: новый request_id (тот же id с другим
    /// телом — гарантированный PT409, 200:85-88), ошибка снимается. Пустой
    /// draft после успешной отправки — программная очистка, состояние
    /// «отправлено» остаётся видимым.
    func draftEdited() {
        if sendState == .failed {
            requestId = UUID()
            sendState = .idle
        } else if sendState == .sent, !draft.isEmpty {
            sendState = .idle
        }
    }
}

struct MessagesThreadView: View {
    @StateObject private var model = MessagesThreadModel()

    var body: some View {
        Group {
            if model.isLoaded {
                threadBody
            } else if model.initialLoadFailed {
                VStack(spacing: 12) {
                    Text("messages_unavailable")
                        .multilineTextAlignment(.center)
                    Button("retry_button") {
                        Task { await model.loadInitial() }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(32)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("messages_title")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if !model.isLoaded {
                await model.loadInitial()
            }
            // Умеренный поллинг первой страницы, пока экран на виду;
            // .task отменяет цикл при уходе с экрана.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if Task.isCancelled { break }
                await model.refreshLatest()
            }
        }
    }

    private var threadBody: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if model.awaitState == "awaiting_student" {
                        Text("messages_awaiting_you")
                            .font(.footnote.weight(.medium))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(10)
                            .background(
                                Color("AccentColor").opacity(0.08),
                                in: RoundedRectangle(cornerRadius: 10)
                            )
                    }

                    if model.hasEarlier {
                        Button {
                            Task { await model.loadEarlier() }
                        } label: {
                            if model.isLoadingEarlier {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                            } else {
                                Text("messages_load_earlier")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.isLoadingEarlier)
                        if model.loadEarlierFailed {
                            Text("messages_load_earlier_error")
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                    }

                    if model.messages.isEmpty {
                        VStack(spacing: 6) {
                            Text("messages_empty_title")
                                .font(.headline)
                            Text("messages_empty_body")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                    } else {
                        ForEach(model.messages) { message in
                            MessageRow(message: message)
                        }
                    }

                    if model.refreshFailed {
                        HStack(spacing: 8) {
                            Text("messages_refresh_error")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Button("retry_button") {
                                Task { await model.refreshLatest() }
                            }
                            .font(.footnote)
                        }
                    }
                }
                .padding(16)
            }
            .defaultScrollAnchor(.bottom)
            .refreshable { await model.refreshLatest() }

            composer
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            switch model.sendState {
            case .sending:
                Text("messages_sending")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            case .sent:
                Text("messages_sent")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            case .failed:
                HStack(spacing: 8) {
                    Text("messages_send_error")
                        .font(.caption)
                        .foregroundStyle(.red)
                    Button("retry_button") {
                        // Ретрай без правки текста: тот же request_id и то же
                        // тело — идемпотентный replay (200:80-90).
                        Task { await model.send() }
                    }
                    .font(.caption)
                }
            case .idle:
                EmptyView()
            }

            HStack(alignment: .bottom, spacing: 8) {
                TextField("messages_composer_placeholder", text: $model.draft, axis: .vertical)
                    .lineLimit(1...4)
                    .textFieldStyle(.roundedBorder)
                    .disabled(model.sendState == .sending)
                    .onChange(of: model.draft) {
                        model.draftEdited()
                    }
                Button {
                    Task { await model.send() }
                } label: {
                    if model.sendState == .sending {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                    }
                }
                .disabled(!model.canSend)
                .accessibilityLabel(Text("messages_send"))
            }

            if model.draft.count > PortalCaseChatPolicy.bodyLimit {
                Text("messages_limit_hint")
                    .font(.caption2)
                    .foregroundStyle(.red)
            } else {
                Text("messages_limit_hint")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(.thinMaterial)
    }
}

private struct MessageRow: View {
    let message: PortalCaseChatMessage

    var body: some View {
        HStack {
            if message.mine { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 4) {
                if !message.mine {
                    Text(message.authorName)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                if let preview = message.quotedBodyPreview {
                    Text(String(
                        format: String(localized: "messages_quoted_prefix"),
                        preview
                    ))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 8)
                    .overlay(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Color("AccentColor").opacity(0.5))
                            .frame(width: 2)
                    }
                }
                if !message.body.isEmpty {
                    Text(message.body)
                        .font(.subheadline)
                }
                // Документ-карточка: NULL label — честная нейтральная
                // подпись (слот удалён), никакого выдуманного названия.
                // task-вложения не рендерятся ВОВСЕ (контракт §6):
                // attachmentLabel для них всегда NULL по построению.
                if message.isDocumentAttachment {
                    Label(
                        String(
                            format: String(localized: "messages_attachment_document"),
                            message.attachmentLabel ?? "—"
                        ),
                        systemImage: "doc"
                    )
                    .font(.caption)
                    .padding(6)
                    .background(Color(.tertiarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
                }
                if let time = PostgresTimestamp.chatLabel(
                    from: message.createdAt,
                    locale: AppLocale.current
                ) {
                    Text(time)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(10)
            .background(
                message.mine
                    ? Color("AccentColor").opacity(0.10)
                    : Color(.secondarySystemBackground),
                in: RoundedRectangle(cornerRadius: 12)
            )
            if !message.mine { Spacer(minLength: 40) }
        }
    }
}
