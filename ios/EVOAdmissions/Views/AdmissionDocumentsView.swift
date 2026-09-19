import QuickLook
import SwiftUI
import UniformTypeIdentifiers

/// «Документы» — iOS-паритет веб-чеклиста (DocumentsView.tsx +
/// PortalDocumentControls.tsx):
/// - чтение — тот же RPC `student_portal_documents` (128:675-694): слот,
///   инструкции, статус, срок, последняя версия (version_no — честный
///   счётчик версий; отдельного RPC истории у веба нет), решение проверки
///   и причина доработки;
/// - загрузка — POST на вебовый route handler с `Authorization: Bearer` и
///   ЗАМОРОЖЕННЫМ на попытку `Idempotency-Key` (ретрай шлёт тот же ключ и
///   те же байты; другой файл/успех сбрасывают ключ) — контракт ADR 0030 §3,
///   серверная часть строится параллельно (PORT-8a);
/// - скачивание — GET download-handler'а (302 → подписанный URL; заголовок
///   Authorization на чужой хост не уходит) и QuickLook-превью.
@MainActor
final class AdmissionDocumentsModel: ObservableObject {
    enum UploadState: Equatable {
        case idle
        case uploading
        case success(filename: String)
        case failed(PortalDocumentTransfer.UploadFailure)
    }

    struct PickedFile: Equatable {
        let filename: String
        let mimeType: String
        let data: Data
    }

    @Published private(set) var documents: [StudentPortalDocumentRow] = []
    @Published private(set) var isLoaded = false
    @Published private(set) var loadFailed = false

    @Published private(set) var uploadStates: [UUID: UploadState] = [:]
    @Published private(set) var downloadingVersionId: UUID?
    @Published private(set) var downloadFailedVersionId: UUID?
    @Published var previewFileURL: URL?

    private var idempotency: [UUID: DocumentUploadIdempotency] = [:]
    private var pickedFiles: [UUID: PickedFile] = [:]

    private let service: SupabaseService

    init(service: SupabaseService = .shared) {
        self.service = service
    }

    func uploadState(for slotId: UUID) -> UploadState {
        uploadStates[slotId] ?? .idle
    }

    /// Ретрай возможен, пока в памяти остаются байты неудавшейся попытки.
    func canRetryUpload(for slotId: UUID) -> Bool {
        if case .failed = uploadState(for: slotId) {
            return pickedFiles[slotId] != nil
        }
        return false
    }

    func load() async {
        loadFailed = false
        do {
            documents = try await service.studentPortalDocuments()
            isLoaded = true
        } catch {
            loadFailed = true
        }
    }

    // MARK: - Upload (bearer contract, PORT-8a)

    /// Пользователь выбрал файл: НОВАЯ попытка — прежний замороженный ключ
    /// сбрасывается (веб: onChange обнуляет uploadIdempotencyKeyRef).
    func filePicked(slotId: UUID, result: Result<URL, Error>) async {
        switch result {
        case .failure:
            uploadStates[slotId] = .failed(.badFile)
        case .success(let url):
            guard let picked = Self.readPickedFile(at: url) else {
                uploadStates[slotId] = .failed(.badFile)
                return
            }
            guard picked.data.count <= PortalDocumentTransfer.maxByteSize else {
                uploadStates[slotId] = .failed(.tooLarge)
                return
            }
            idempotency[slotId, default: DocumentUploadIdempotency()].fileChanged()
            pickedFiles[slotId] = picked
            await upload(slotId: slotId)
        }
    }

    /// Ретрай той же попытки: тот же Idempotency-Key, те же байты — сервер
    /// повторит ту же резервацию, а не создаст дубль.
    func retryUpload(slotId: UUID) async {
        await upload(slotId: slotId)
    }

    private func upload(slotId: UUID) async {
        guard let picked = pickedFiles[slotId] else { return }
        uploadStates[slotId] = .uploading
        do {
            let token = try await service.currentAccessToken()
            let key = idempotency[slotId, default: DocumentUploadIdempotency()]
                .keyForAttempt()
            let boundary = "evo-\(UUID().uuidString)"
            var request = PortalDocumentTransfer.uploadRequest(
                baseURL: AppConfig.portalWebBaseURL,
                documentSlotId: slotId,
                idempotencyKey: key,
                accessToken: token,
                boundary: boundary
            )
            request.httpBody = PortalDocumentTransfer.multipartBody(
                boundary: boundary,
                filename: picked.filename,
                mimeType: picked.mimeType,
                fileData: picked.data
            )
            let (body, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                uploadStates[slotId] = .failed(.network)
                return
            }
            guard http.statusCode == 201 else {
                uploadStates[slotId] = .failed(
                    PortalDocumentTransfer.failure(forStatus: http.statusCode)
                )
                return
            }
            guard
                let receipt = try? JSONDecoder().decode(
                    PortalDocumentTransfer.UploadReceipt.self,
                    from: body
                ),
                receipt.document.documentSlotId == slotId,
                receipt.document.versionNumber >= 1
            else {
                // 201 без пригодного receipt — как errorReceipt в вебе.
                uploadStates[slotId] = .failed(.badReceipt)
                return
            }
            idempotency[slotId]?.uploadSucceeded()
            pickedFiles[slotId] = nil
            uploadStates[slotId] = .success(filename: receipt.document.originalFilename)
            await load()
        } catch {
            uploadStates[slotId] = .failed(.network)
        }
    }

    /// Читает выбранный файл через security-scoped доступ и определяет MIME
    /// по объявленному типу файла; вне трёх разрешённых типов — nil.
    private nonisolated static func readPickedFile(at url: URL) -> PickedFile? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return nil }
        let contentType = (try? url.resourceValues(forKeys: [.contentTypeKey]))?.contentType
        let mimeType: String?
        if let contentType {
            if contentType.conforms(to: .pdf) {
                mimeType = "application/pdf"
            } else if contentType.conforms(to: .jpeg) {
                mimeType = "image/jpeg"
            } else if contentType.conforms(to: .png) {
                mimeType = "image/png"
            } else {
                mimeType = nil
            }
        } else {
            mimeType = nil
        }
        guard let mimeType else { return nil }
        return PickedFile(filename: url.lastPathComponent, mimeType: mimeType, data: data)
    }

    // MARK: - Download (302 → signed URL → QuickLook)

    func download(versionId: UUID, suggestedFilename: String?) async {
        downloadFailedVersionId = nil
        downloadingVersionId = versionId
        defer { downloadingVersionId = nil }
        do {
            let token = try await service.currentAccessToken()
            let request = PortalDocumentTransfer.downloadRequest(
                baseURL: AppConfig.portalWebBaseURL,
                documentVersionId: versionId,
                accessToken: token
            )
            let session = URLSession(
                configuration: .ephemeral,
                delegate: PortalDownloadRedirectDelegate(),
                delegateQueue: nil
            )
            defer { session.finishTasksAndInvalidate() }
            let (data, response) = try await session.data(for: request)
            guard
                let http = response as? HTTPURLResponse,
                http.statusCode == 200,
                !data.isEmpty
            else {
                downloadFailedVersionId = versionId
                return
            }
            let filename = suggestedFilename ?? "document-\(versionId.uuidString.lowercased())"
            let target = FileManager.default.temporaryDirectory
                .appending(path: "portal-documents", directoryHint: .isDirectory)
                .appending(path: versionId.uuidString.lowercased(), directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
            let fileURL = target.appending(path: filename)
            try data.write(to: fileURL, options: .atomic)
            previewFileURL = fileURL
        } catch {
            downloadFailedVersionId = versionId
        }
    }
}

struct AdmissionDocumentsView: View {
    @StateObject private var model = AdmissionDocumentsModel()
    /// Слот, для которого открыт системный выбор файла. Хранится отдельно от
    /// isPresented-флага: SwiftUI может сбросить презентацию ДО вызова
    /// completion, а слот должен дожить до него.
    @State private var pickerSlotId: UUID?
    @State private var isPickerPresented = false

    var body: some View {
        Group {
            if model.isLoaded {
                documentsList
            } else if model.loadFailed {
                VStack(spacing: 12) {
                    Text("adm_section_unavailable")
                        .multilineTextAlignment(.center)
                    Button("retry_button") {
                        Task { await model.load() }
                    }
                    .buttonStyle(.bordered)
                }
                .padding(32)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("adm_documents_title")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if !model.isLoaded {
                await model.load()
            }
        }
        .fileImporter(
            isPresented: $isPickerPresented,
            allowedContentTypes: [.pdf, .jpeg, .png]
        ) { result in
            guard let slotId = pickerSlotId else { return }
            pickerSlotId = nil
            Task { await model.filePicked(slotId: slotId, result: result) }
        }
        .quickLookPreview($model.previewFileURL)
    }

    @ViewBuilder
    private var documentsList: some View {
        if model.documents.isEmpty {
            VStack(spacing: 6) {
                Text("adm_documents_empty_title")
                    .font(.headline)
                Text("adm_documents_empty_body")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(32)
        } else {
            List {
                Section {
                    progressSummary
                } header: {
                    Text("adm_checklist_heading")
                } footer: {
                    Text("adm_bishkek_note")
                }

                ForEach(model.documents) { document in
                    Section {
                        DocumentSlotRow(
                            document: document,
                            uploadState: model.uploadState(for: document.documentSlotId),
                            canRetry: model.canRetryUpload(for: document.documentSlotId),
                            isDownloading: model.downloadingVersionId == document.documentVersionId
                                && document.documentVersionId != nil,
                            downloadFailed: model.downloadFailedVersionId == document.documentVersionId
                                && document.documentVersionId != nil,
                            onPickFile: {
                                pickerSlotId = document.documentSlotId
                                isPickerPresented = true
                            },
                            onRetryUpload: {
                                Task { await model.retryUpload(slotId: document.documentSlotId) }
                            },
                            onDownload: {
                                guard let versionId = document.documentVersionId else { return }
                                Task {
                                    await model.download(
                                        versionId: versionId,
                                        suggestedFilename: document.originalFilename
                                    )
                                }
                            }
                        )
                    }
                }
            }
            .refreshable { await model.load() }
        }
    }

    /// Счётчик «Принято X из Y» + честные факты (веб documentProgress).
    private var progressSummary: some View {
        let total = model.documents.count
        let approved = AdmissionDocumentProgress.approvedCount(model.documents)
        let missing = AdmissionDocumentProgress.missingCount(model.documents)
        let corrections = AdmissionDocumentProgress.correctionsCount(model.documents)
        let inReview = AdmissionDocumentProgress.inReviewCount(model.documents)

        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("adm_accepted_label")
                    .font(.subheadline)
                Text(String(
                    format: String(localized: "adm_accepted_share"),
                    String(approved),
                    String(total)
                ))
                .font(.subheadline.weight(.semibold))
            }
            ProgressView(value: Double(approved), total: Double(max(total, 1)))
            Text(approved == total ? "adm_accepted_all" : "adm_accepted_after_review")
                .font(.caption)
                .foregroundStyle(.secondary)
            if missing > 0 || corrections > 0 || inReview > 0 {
                VStack(alignment: .leading, spacing: 2) {
                    if missing > 0 {
                        factLine("adm_doc_missing_term", count: missing)
                    }
                    if corrections > 0 {
                        factLine("adm_doc_corrections_term", count: corrections)
                    }
                    if inReview > 0 {
                        factLine("adm_doc_in_review_term", count: inReview)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func factLine(_ key: LocalizedStringKey, count: Int) -> some View {
        (Text(key) + Text(verbatim: " ") + Text(verbatim: String(count)).bold())
            .font(.caption)
            .foregroundStyle(.secondary)
    }
}

/// Один слот чеклиста: заголовок + статус, инструкции, факты (срок,
/// последний файл с версией, решение), причина доработки, следующий шаг
/// и контролы загрузки/скачивания.
private struct DocumentSlotRow: View {
    let document: StudentPortalDocumentRow
    let uploadState: AdmissionDocumentsModel.UploadState
    let canRetry: Bool
    let isDownloading: Bool
    let downloadFailed: Bool
    let onPickFile: () -> Void
    let onRetryUpload: () -> Void
    let onDownload: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Text(document.requirementLabel)
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 8)
                statusPill
            }

            if let instructions = document.instructions {
                Text(instructions)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            facts

            if let reworkReason = document.reworkReason {
                VStack(alignment: .leading, spacing: 2) {
                    Text("adm_rework_title")
                        .font(.caption.weight(.semibold))
                    Text(reworkReason)
                        .font(.caption)
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityElement(children: .combine)
            }

            if let nextAction = document.nextAction {
                (Text("adm_next_step_label") + Text(verbatim: " ") + Text(verbatim: nextAction))
                    .font(.footnote)
            }

            controls
        }
        .padding(.vertical, 4)
    }

    // MARK: Статус слота (5 значений document_slot_status; тона веба)

    private var statusPill: some View {
        Text(statusKey)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(statusColor.opacity(0.12), in: Capsule())
            .foregroundStyle(statusColor)
    }

    private var statusKey: LocalizedStringKey {
        switch document.slotStatus {
        case "required": return "adm_doc_status_required"
        case "submitted": return "adm_doc_status_submitted"
        case "approved": return "adm_doc_status_approved"
        case "correction_required": return "adm_doc_status_correction_required"
        case "rejected": return "adm_doc_status_rejected"
        default: return "adm_status_unavailable"
        }
    }

    private var statusColor: Color {
        switch document.slotStatus {
        case "approved": return .green
        case "correction_required": return .orange
        case "rejected": return .red
        case "submitted": return .blue
        default: return .secondary
        }
    }

    // MARK: Факты (срок / последний файл / решение)

    @ViewBuilder
    private var facts: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let deadline = AdmissionTimestamp.label(from: document.deadline) {
                factRow(term: "adm_deadline_term", value: deadline)
            }
            if let filename = document.originalFilename {
                factRow(term: "adm_last_file_term", value: fileLine(filename))
            }
            if let decision = reviewDecisionText {
                factRow(term: "adm_decision_term", value: decision)
            }
        }
    }

    /// «имя · версия N · дата» — version_no и есть честная история версий
    /// (отдельного RPC у веба нет).
    private func fileLine(_ filename: String) -> String {
        var parts = [filename]
        if let versionNo = document.versionNo {
            parts.append(String(
                format: String(localized: "adm_version_no"),
                String(versionNo)
            ))
        }
        if let submitted = AdmissionTimestamp.label(from: document.submittedAt) {
            parts.append(submitted)
        }
        return parts.joined(separator: " · ")
    }

    private var reviewDecisionText: String? {
        switch document.reviewDecision {
        case "approved": return String(localized: "adm_review_approved")
        case "correction_required": return String(localized: "adm_review_correction_required")
        case "rejected": return String(localized: "adm_review_rejected")
        case nil: return nil
        default: return String(localized: "adm_status_unavailable")
        }
    }

    private func factRow(term: LocalizedStringKey, value: String) -> some View {
        (Text(term) + Text(verbatim: ": ") + Text(verbatim: value))
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    // MARK: Контролы (upload / download)

    @ViewBuilder
    private var controls: some View {
        VStack(alignment: .leading, spacing: 6) {
            if document.allowsUpload {
                uploadControl
            } else {
                // Принятый документ — только скачивание (веб uploadLocked).
                Text("adm_upload_locked")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if document.documentVersionId != nil {
                Button {
                    onDownload()
                } label: {
                    if isDownloading {
                        HStack(spacing: 6) {
                            ProgressView()
                            Text("adm_downloading")
                        }
                    } else {
                        Label("adm_download_button", systemImage: "arrow.down.doc")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(isDownloading)
                .accessibilityLabel(Text(String(
                    format: String(localized: "adm_download_aria"),
                    document.originalFilename ?? String(localized: "adm_last_file_fallback")
                )))
                if downloadFailed {
                    Text("adm_download_error")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
    }

    @ViewBuilder
    private var uploadControl: some View {
        switch uploadState {
        case .uploading:
            HStack(spacing: 8) {
                ProgressView()
                // Честное неопределённое состояние: процент байтов, как в
                // веб-XHR, здесь не показывается — и не выдумывается.
                Text("adm_uploading")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .success(let filename):
            VStack(alignment: .leading, spacing: 4) {
                Text(String(format: String(localized: "adm_upload_success"), filename))
                    .font(.caption)
                    .foregroundStyle(.green)
                pickButton
            }
        case .failed(let failure):
            VStack(alignment: .leading, spacing: 4) {
                Text(failureKey(failure))
                    .font(.caption)
                    .foregroundStyle(.red)
                HStack(spacing: 8) {
                    if canRetry {
                        // Ретрай той же попытки: тот же Idempotency-Key и те
                        // же байты (замороженная пара, веб-семантика).
                        Button("adm_retry_upload") { onRetryUpload() }
                            .buttonStyle(.borderedProminent)
                    }
                    pickButton
                }
            }
        case .idle:
            VStack(alignment: .leading, spacing: 4) {
                pickButton
                Text("adm_upload_hint")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var pickButton: some View {
        Button {
            onPickFile()
        } label: {
            Label("adm_upload_button", systemImage: "square.and.arrow.up")
        }
        .buttonStyle(.bordered)
        .disabled(uploadState == .uploading)
        .accessibilityLabel(Text(String(
            format: String(localized: "adm_upload_aria"),
            document.requirementLabel
        )))
    }

    private func failureKey(_ failure: PortalDocumentTransfer.UploadFailure) -> LocalizedStringKey {
        switch failure {
        case .badFile: return "adm_err_bad_file"
        case .forbidden: return "adm_err_forbidden"
        case .conflict: return "adm_err_conflict"
        case .tooLarge: return "adm_err_too_large"
        case .scanRejected: return "adm_err_scan"
        case .rateLimited: return "adm_err_too_many"
        case .unavailable: return "adm_err_unavailable"
        case .network: return "adm_err_network"
        case .badReceipt: return "adm_err_receipt"
        }
    }
}
