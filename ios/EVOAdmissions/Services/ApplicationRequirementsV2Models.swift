import Foundation

/// Read-only v2 projection. The v1 initialization intent and receipt stay separate.
enum ApplicationRequirementsV2Origin: String, Decodable {
    case evoStarter = "evo_starter"
    case staffConfirmed = "staff_confirmed"
}

enum ApplicationRequirementsV2Configuration: String, Decodable {
    case needsConfirmation = "needs_confirmation"
    case confirmed
}

enum ApplicationRequirementReviewScope: String, Decodable {
    case documentVersion = "document_version"
}

enum ApplicationRequirementDefinitionImpact: String, Decodable {
    case changed
}

struct ApplicationRequirementsV2Revision {
    let revisionId: UUID
    let revisionVersion: String
    let origin: ApplicationRequirementsV2Origin
    let configurationState: ApplicationRequirementsV2Configuration
    let initializedAt: String
}

struct ApplicationRequirementDeadline: Decodable {
    let date: String
    let time: String?
    let timezone: String?
    let sourceUrl: String?
    let verifiedOn: String

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case date, time, timezone, sourceUrl, verifiedOn
    }

    init(from decoder: Decoder) throws {
        try RequirementsV2Contract.requireKeys(CodingKeys.allCases, from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        date = try values.decode(String.self, forKey: .date)
        time = try values.decodeIfPresent(String.self, forKey: .time)
        timezone = try values.decodeIfPresent(String.self, forKey: .timezone)
        sourceUrl = try values.decodeIfPresent(String.self, forKey: .sourceUrl)
        verifiedOn = try values.decode(String.self, forKey: .verifiedOn)
        guard RequirementsV2Contract.validDate(date), RequirementsV2Contract.validDate(verifiedOn),
              time.map({ RequirementsV2Contract.matches($0, "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$") }) ?? true,
              time == nil || timezone != nil,
              timezone.map(RequirementsV2Contract.validTimezone) ?? true,
              sourceUrl.map(RequirementsV2Contract.validPublicURL) ?? true else {
            throw RequirementsV2Contract.corrupted(decoder, "Invalid requirement deadline.")
        }
    }
}

struct ApplicationRequirementV2Item: Decodable, Identifiable {
    var id: UUID { requirementItemId }
    let requirementItemId: UUID
    let requirementKey: String
    let documentSlotId: UUID
    let position: Int
    let required: Bool
    let label: String
    let groupLabel: String
    let instructions: String
    let compatibilityKey: String
    let slotStatus: ApplicationRequirementSlotStatus?
    let currentVersionId: UUID?
    let currentVersionNo: String?
    let reviewDecision: ApplicationRequirementReviewDecision?
    let reviewReason: String?
    let reviewedAt: String?
    let technicalAvailability: ApplicationRequirementTechnicalAvailability
    let unavailableReasons: [ApplicationRequirementUnavailableReason]
    let deadline: ApplicationRequirementDeadline?
    let reviewScope: ApplicationRequirementReviewScope
    /// nil makes no assertion about an earlier definition or review applicability.
    let definitionImpact: ApplicationRequirementDefinitionImpact?

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case requirementItemId, requirementKey, documentSlotId, position, required
        case label, groupLabel, instructions, compatibilityKey, slotStatus
        case currentVersionId, currentVersionNo, reviewDecision, reviewReason, reviewedAt
        case technicalAvailability, unavailableReasons, deadline, reviewScope, definitionImpact
    }

    init(from decoder: Decoder) throws {
        try RequirementsV2Contract.requireKeys(CodingKeys.allCases, from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        requirementItemId = try values.requirementsV2UUID(forKey: .requirementItemId)
        requirementKey = try values.decode(String.self, forKey: .requirementKey)
        documentSlotId = try values.requirementsV2UUID(forKey: .documentSlotId)
        position = try values.decode(Int.self, forKey: .position)
        required = try values.decode(Bool.self, forKey: .required)
        label = try values.decode(String.self, forKey: .label)
        groupLabel = try values.decode(String.self, forKey: .groupLabel)
        instructions = try values.decode(String.self, forKey: .instructions)
        compatibilityKey = try values.decode(String.self, forKey: .compatibilityKey)
        slotStatus = try values.decodeIfPresent(ApplicationRequirementSlotStatus.self, forKey: .slotStatus)
        currentVersionId = try values.decodeNil(forKey: .currentVersionId)
            ? nil : values.requirementsV2UUID(forKey: .currentVersionId)
        currentVersionNo = try values.decodeIfPresent(String.self, forKey: .currentVersionNo)
        reviewDecision = try values.decodeIfPresent(ApplicationRequirementReviewDecision.self, forKey: .reviewDecision)
        reviewReason = try values.decodeIfPresent(String.self, forKey: .reviewReason)
        reviewedAt = try values.decodeIfPresent(String.self, forKey: .reviewedAt)
        technicalAvailability = try values.decode(ApplicationRequirementTechnicalAvailability.self, forKey: .technicalAvailability)
        unavailableReasons = try values.decode([ApplicationRequirementUnavailableReason].self, forKey: .unavailableReasons)
        deadline = try values.decodeIfPresent(ApplicationRequirementDeadline.self, forKey: .deadline)
        reviewScope = try values.decode(ApplicationRequirementReviewScope.self, forKey: .reviewScope)
        definitionImpact = try values.decodeIfPresent(ApplicationRequirementDefinitionImpact.self, forKey: .definitionImpact)

        guard position > 0, RequirementsV2Contract.validKey(requirementKey),
              RequirementsV2Contract.validKey(compatibilityKey),
              RequirementsV2Contract.validText(label, maximum: 500),
              RequirementsV2Contract.validText(groupLabel, maximum: 200),
              RequirementsV2Contract.validText(instructions, maximum: 4000),
              (currentVersionId == nil) == (currentVersionNo == nil),
              currentVersionNo.map(RequirementsV2Contract.validVersion) ?? true,
              (reviewDecision == nil) == (reviewedAt == nil),
              reviewedAt.map(RequirementsV2Contract.validTimestamp) ?? true,
              reviewReason.map(RequirementsV2Contract.nonempty) ?? true,
              (reviewDecision != nil && reviewDecision != .approved) || reviewReason == nil,
              currentVersionId != nil || reviewDecision == nil,
              Set(unavailableReasons).count == unavailableReasons.count,
              unavailableReasons.filter({ $0.rawValue.hasPrefix("integrity_") }).count <= 1,
              unavailableReasons.filter({ $0.rawValue.hasPrefix("malware_") }).count <= 1 else {
            throw RequirementsV2Contract.corrupted(decoder, "Invalid requirement item.")
        }

        let associationReasons = unavailableReasons.filter(RequirementsV2Contract.isAssociationReason)
        if !associationReasons.isEmpty {
            guard associationReasons.count == unavailableReasons.count,
                  technicalAvailability == .unavailable, slotStatus == nil,
                  currentVersionId == nil, reviewDecision == nil else {
                throw RequirementsV2Contract.corrupted(decoder, "Unavailable association exposes document state.")
            }
        } else {
            guard slotStatus != nil else {
                throw RequirementsV2Contract.corrupted(decoder, "Missing slot state without an association reason.")
            }
            switch technicalAvailability {
            case .available:
                guard currentVersionId != nil, unavailableReasons.isEmpty else {
                    throw RequirementsV2Contract.corrupted(decoder, "Available file has unavailable evidence.")
                }
            case .unavailable:
                guard !unavailableReasons.isEmpty,
                      (currentVersionId == nil ? unavailableReasons == [.fileMissing] : !unavailableReasons.contains(.fileMissing)) else {
                    throw RequirementsV2Contract.corrupted(decoder, "Unavailable file has inconsistent version evidence.")
                }
            }
        }
    }
}

struct ApplicationRequirementsV2View: Decodable {
    let protocolVersion: Int
    let studentCaseId: UUID
    let applicationId: UUID
    let state: ApplicationRequirementsState
    let revision: ApplicationRequirementsV2Revision?
    let configurationReasons: [ApplicationRequirementsConfigurationReason]
    let items: [ApplicationRequirementV2Item]

    private enum CodingKeys: String, CodingKey, CaseIterable {
        case protocolVersion, studentCaseId, applicationId, state, revisionId, revisionVersion
        case origin, configurationState, initializedAt, configurationReasons, items
    }

    init(from decoder: Decoder) throws {
        try RequirementsV2Contract.requireKeys(CodingKeys.allCases, from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        protocolVersion = try values.decode(Int.self, forKey: .protocolVersion)
        studentCaseId = try values.requirementsV2UUID(forKey: .studentCaseId)
        applicationId = try values.requirementsV2UUID(forKey: .applicationId)
        state = try values.decode(ApplicationRequirementsState.self, forKey: .state)
        configurationReasons = try values.decode([ApplicationRequirementsConfigurationReason].self, forKey: .configurationReasons)
        items = try values.decode([ApplicationRequirementV2Item].self, forKey: .items)
        guard protocolVersion == 2, Set(configurationReasons).count == configurationReasons.count else {
            throw RequirementsV2Contract.corrupted(decoder, "Invalid requirements protocol or duplicate reason.")
        }
        if try values.decodeNil(forKey: .revisionId) {
            for key in [CodingKeys.revisionVersion, .origin, .configurationState, .initializedAt] {
                guard try values.decodeNil(forKey: key) else {
                    throw RequirementsV2Contract.corrupted(decoder, "Missing revision has non-null metadata.")
                }
            }
            revision = nil
            guard items.isEmpty,
                  (state == .uninitialized && configurationReasons.isEmpty)
                    || (state == .needsConfiguration && !configurationReasons.isEmpty) else {
                throw RequirementsV2Contract.corrupted(decoder, "Invalid requirements state without a revision.")
            }
            return
        }

        let revisionId = try values.requirementsV2UUID(forKey: .revisionId)
        let revisionVersion = try values.decode(String.self, forKey: .revisionVersion)
        let origin = try values.decode(ApplicationRequirementsV2Origin.self, forKey: .origin)
        let configurationState = try values.decode(ApplicationRequirementsV2Configuration.self, forKey: .configurationState)
        let initializedAt = try values.decode(String.self, forKey: .initializedAt)
        guard RequirementsV2Contract.validVersion(revisionVersion),
              RequirementsV2Contract.validTimestamp(initializedAt),
              (origin == .evoStarter && configurationState == .needsConfirmation)
                || (origin == .staffConfirmed && configurationState == .confirmed),
              !items.isEmpty,
              items.enumerated().allSatisfy({ $0.element.position == $0.offset + 1 }),
              Set(items.map(\.requirementItemId)).count == items.count,
              Set(items.map(\.requirementKey)).count == items.count,
              Set(items.map(\.documentSlotId)).count == items.count else {
            throw RequirementsV2Contract.corrupted(decoder, "Invalid requirements revision or item identities.")
        }
        if origin == .evoStarter {
            guard items.map(\.requirementKey) == ["evo.photo.v1", "evo.passport.v1"],
                  items.allSatisfy({ $0.required && $0.compatibilityKey == $0.requirementKey }) else {
                throw RequirementsV2Contract.corrupted(decoder, "Invalid starter composition.")
            }
        }
        var expectedReasons = Set<ApplicationRequirementsConfigurationReason>()
        for item in items {
            for reason in item.unavailableReasons where RequirementsV2Contract.isAssociationReason(reason) {
                expectedReasons.insert(reason == .slotMetadataChanged ? .materialMetadataChanged : .materialAssociationUnavailable)
            }
        }
        guard Set(configurationReasons) == expectedReasons,
              state == (expectedReasons.isEmpty ? .initialized : .needsConfiguration) else {
            throw RequirementsV2Contract.corrupted(decoder, "Requirements configuration contradicts its item associations.")
        }
        revision = ApplicationRequirementsV2Revision(revisionId: revisionId, revisionVersion: revisionVersion,
            origin: origin, configurationState: configurationState, initializedAt: initializedAt)
    }

    func validate(studentCaseId: UUID, applicationId: UUID) throws {
        guard self.studentCaseId == studentCaseId, self.applicationId == applicationId else {
            throw ApplicationRequirementsContractError.mismatchedResponse
        }
    }
}

private enum RequirementsV2Contract {
    static func validUUID(_ raw: String) -> Bool {
        matches(raw, "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    }

    static func validVersion(_ value: String) -> Bool {
        value.utf8.count <= 19 && matches(value, "^[1-9][0-9]*$") && Int64(value).map { $0 > 0 } == true
    }

    static func validKey(_ value: String) -> Bool {
        value.unicodeScalars.count <= 100 && matches(value, "^[a-z][a-z0-9_.-]*$")
    }

    static func validText(_ value: String, maximum: Int) -> Bool {
        nonempty(value) && value.unicodeScalars.count <= maximum
    }

    static func nonempty(_ value: String) -> Bool {
        !value.replacingOccurrences(of: "[\\p{White_Space}\u{FEFF}]", with: "", options: .regularExpression).isEmpty
    }

    static func validDate(_ value: String) -> Bool {
        guard matches(value, "^[0-9]{4}-[0-9]{2}-[0-9]{2}$") else { return false }
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, parts[0] > 0, (1...12).contains(parts[1]), parts[2] > 0 else { return false }
        let leap = parts[0] % 4 == 0 && (parts[0] % 100 != 0 || parts[0] % 400 == 0)
        let days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        return parts[2] <= days[parts[1] - 1]
    }

    static func validTimestamp(_ value: String) -> Bool {
        matches(value, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$")
            && validDate(String(value.prefix(10))) && PostgresTimestamp.date(from: value) != nil
    }

    static func validTimezone(_ value: String) -> Bool {
        guard (1...100).contains(value.utf8.count), value.unicodeScalars.allSatisfy({ $0.isASCII }),
              !value.lowercased().hasPrefix("posix/"), !value.lowercased().hasPrefix("right/") else { return false }
        return (value == "UTC" || value == "GMT" || matches(value, "^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+$"))
            && TimeZone(identifier: value) != nil
    }

    static func validPublicURL(_ value: String) -> Bool {
        guard (1...1000).contains(value.unicodeScalars.count), value.hasPrefix("https://"),
              value.range(of: "[\\p{White_Space}\u{FEFF}]", options: .regularExpression) == nil,
              !value.unicodeScalars.contains(where: { $0.value <= 31 || $0.value == 127 }),
              !value.contains("\\"), !value.contains("#") else { return false }
        let remainder = value.dropFirst("https://".count)
        let authority = remainder.prefix { $0 != "/" && $0 != "?" }
        guard authority.unicodeScalars.allSatisfy({ $0.isASCII }) else { return false }
        let host = authority.lowercased()
        guard
              matches(host, "^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$"),
              !matches(host, ".*\\.(?:localhost|local|internal|test|invalid|example)$") else { return false }
        if let queryStart = value.firstIndex(of: "?") {
            let query = value[value.index(after: queryStart)...]
            for parameter in query.split(separator: "&", omittingEmptySubsequences: false) {
                let rawKey = parameter.prefix { $0 != "=" }
                let key = rawKey.replacingOccurrences(of: "+", with: " ")
                if key.contains("%") || key.range(of: "token|secret|password|auth|api.?key", options: [.regularExpression, .caseInsensitive]) != nil {
                    return false
                }
            }
        }
        guard let components = URLComponents(string: value), components.url != nil else { return false }
        return components.scheme == "https" && components.user == nil && components.password == nil
    }

    static func isAssociationReason(_ reason: ApplicationRequirementUnavailableReason) -> Bool {
        [.slotMissing, .slotRemoved, .applicationLinkMissing, .slotMetadataChanged].contains(reason)
    }

    static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) == value.startIndex..<value.endIndex
    }

    static func corrupted(_ decoder: Decoder, _ message: String) -> DecodingError {
        .dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: message))
    }

    private struct Key: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    static func requireKeys<T: CodingKey>(_ expected: [T], from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: Key.self)
        guard Set(values.allKeys.map(\.stringValue)) == Set(expected.map(\.stringValue)) else {
            throw corrupted(decoder, "Unexpected v2 requirements response fields.")
        }
    }
}

private extension KeyedDecodingContainer {
    func requirementsV2UUID(forKey key: Key) throws -> UUID {
        let raw = try decode(String.self, forKey: key)
        guard RequirementsV2Contract.validUUID(raw), let value = UUID(uuidString: raw) else {
            throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "Expected a canonical lowercase UUID.")
        }
        return value
    }
}
