import Foundation

struct ProgramPackageChoice {
    let item: ApplicationPackageSelectionItem
    let file: ApplicationDocumentFileSummary
}

/// Explicit selections survive a new saved draft. A changed revision requires
/// an explicit reset; no predecessor or newest-version substitution occurs.
struct ProgramPackageSelectionState {
    private(set) var revisionId: String?
    private(set) var choices: [String: ProgramPackageChoice] = [:]
    private(set) var includedOptional: Set<String> = []
    private(set) var revisionChanged = false
    mutating func observe(_ readiness: ApplicationPackageReadiness) {
        let current = readiness.requirements.revision?.revisionId.uuidString.lowercased()
        if revisionId == nil { revisionId = current }
        else if revisionId != current { revisionChanged = true }
    }
    mutating func reset(_ readiness: ApplicationPackageReadiness) {
        self = Self(); revisionId = readiness.requirements.revision?.revisionId.uuidString.lowercased()
    }
    mutating func include(_ id: String, value: Bool) {
        if value { includedOptional.insert(id) }
        else { includedOptional.remove(id); choices.removeValue(forKey: id) }
    }
    mutating func choose(item: ApplicationDocumentItem, selection: ApplicationDocumentSelection, file: ApplicationDocumentFileSummary) throws {
        guard !revisionChanged, selection.documentVersionId == file.id else { throw ApplicationPackageClientError.invalidIntent }
        choices[item.id] = ProgramPackageChoice(item: try .init(requirementItemId: item.id, selection: selection, expectedPreviousSubmissionId: item.submission?.submissionId), file: file)
    }
    func items(for readiness: ApplicationPackageReadiness) -> [ApplicationPackageSelectionItem] {
        readiness.requirements.items.compactMap { requirement in
            let id = requirement.id.uuidString.lowercased()
            guard requirement.required || includedOptional.contains(id) else { return nil }
            return choices[id]?.item
        }
    }
    func missingOptionalFile(in readiness: ApplicationPackageReadiness) -> Bool {
        readiness.requirements.items.contains { !$0.required && includedOptional.contains($0.id.uuidString.lowercased()) && choices[$0.id.uuidString.lowercased()] == nil }
    }
}
