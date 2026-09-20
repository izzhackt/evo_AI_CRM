import Foundation

/// Codable mirrors of the profession-card READ contracts in
/// `supabase/migrations/198_platform_learning_engine.sql` (content seeded by
/// migration 199, e.g. 199:359-360 `project-manager`).

// MARK: - Grid (`platform.profession_cards_v1`, 198:1038-1051)

/// Top-level shape: `jsonb_build_object('cards', …)` (198:1050).
struct ProfessionCardsResponse: Decodable {
    let cards: [ProfessionCardSummary]
}

/// Compact list row (198:1043-1047): `{cardId, cardKey, version, titleRu,
/// titleKy, orvisScales}`. `orvisScales` holds 1-3 of the 8 known scale ids
/// (validator 198:354-363), first one is primary.
struct ProfessionCardSummary: Decodable, Identifiable {
    let cardId: UUID
    let cardKey: String
    let version: String
    let titleRu: String
    let titleKy: String
    let orvisScales: [String]

    var id: UUID { cardId }
}

// MARK: - Card (`platform.profession_card_v1`, 198:1053-1062)

/// `{cardId, cardKey, version, publishedAt, body}` (198:1060-1061);
/// `publishedAt` is a raw timestamptz string.
struct ProfessionCardResponse: Decodable {
    let cardId: UUID
    let cardKey: String
    let version: String
    let publishedAt: String
    let body: ProfessionCardBody
}

/// Full card body in the professions-draft schema, validated to EXACTLY 20
/// keys by `validate_profession_card` (198:340-345). RU/KY list pairs have
/// equal lengths (198:365-378); `linked_program_refs` carry
/// `{institution_photo_key, program_hint}` (198:379-386) — resolved against
/// the student catalogue by photoKey, честный текст без ссылки when absent.
struct ProfessionCardBody: Decodable {
    let id: String
    let titleRu: String
    let titleKy: String
    let orvisScales: [String]
    let dayInWorkRu: String
    let dayInWorkKy: String
    let environmentRu: String
    let environmentKy: String
    let skillsRu: [String]
    let skillsKy: [String]
    let interestingRu: [String]
    let interestingKy: [String]
    let hardRu: [String]
    let hardKy: [String]
    let trialTaskRu: String
    let trialTaskKy: String
    let studyDirectionsRu: [String]
    let studyDirectionsKy: [String]
    let linkedProgramRefs: [ProfessionLinkedProgramRef]
    let sources: [String]

    enum CodingKeys: String, CodingKey {
        case id
        case titleRu = "title_ru"
        case titleKy = "title_ky"
        case orvisScales = "orvis_scales"
        case dayInWorkRu = "day_in_work_ru"
        case dayInWorkKy = "day_in_work_ky"
        case environmentRu = "environment_ru"
        case environmentKy = "environment_ky"
        case skillsRu = "skills_ru"
        case skillsKy = "skills_ky"
        case interestingRu = "interesting_ru"
        case interestingKy = "interesting_ky"
        case hardRu = "hard_ru"
        case hardKy = "hard_ky"
        case trialTaskRu = "trial_task_ru"
        case trialTaskKy = "trial_task_ky"
        case studyDirectionsRu = "study_directions_ru"
        case studyDirectionsKy = "study_directions_ky"
        case linkedProgramRefs = "linked_program_refs"
        case sources
    }
}

struct ProfessionLinkedProgramRef: Decodable {
    let institutionPhotoKey: String
    let programHint: String

    enum CodingKeys: String, CodingKey {
        case institutionPhotoKey = "institution_photo_key"
        case programHint = "program_hint"
    }
}
