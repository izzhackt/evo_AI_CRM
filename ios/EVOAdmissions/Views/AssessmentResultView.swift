import SwiftUI

/// Результат завершённой попытки — по образцу веб-`AssessmentResults`:
/// полоса результата с band (basic/developing/strong — подписи из versioned
/// content), per-topic разбор, разбор заданий; для ORVIS — шкалы интересов и
/// профессии с атрибуцией. Никаких CEFR/сертификатов — честные ограничения
/// из metadata. Результат виден только владельцу и не логируется.
struct AssessmentResultView: View {
    let attempt: AssessmentAttempt

    var body: some View {
        if let result = attempt.result {
            VStack(alignment: .leading, spacing: 20) {
                header(result)
                if let english = result.english {
                    englishTopics(english)
                    englishFeedback(english)
                }
                if let orvis = result.orvis {
                    orvisScales(orvis)
                    orvisProfessions(orvis)
                }
                limitations
            }
        }
    }

    // MARK: - Header

    private func header(_ result: AssessmentResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(String(format: String(localized: "result_completed_version"), result.version))
                .font(.caption)
                .foregroundStyle(.secondary)

            if let english = result.english {
                Text(String(
                    format: String(localized: "result_score"),
                    english.correctCount, english.totalCount
                ))
                .font(.largeTitle.bold())
                Text(bandLabel(english))
                    .font(.headline)
                Text("result_english_note")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text("result_orvis_title")
                    .font(.title2.bold())
                Text("result_orvis_note")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Text("result_private_note")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    private func bandLabel(_ english: EnglishAssessmentResult) -> String {
        guard let band = english.band else {
            return String(localized: "result_band_fallback")
        }
        return attempt.metadata.bands?.first(where: { $0.id == band })?.label
            ?? String(localized: "result_band_fallback")
    }

    // MARK: - English

    private func englishTopics(_ english: EnglishAssessmentResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("result_topics_heading")
                .font(.title3.bold())
            ForEach(english.topics, id: \.topic) { topic in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(topicLabel(topic.topic))
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        Text("\(topic.correctCount) / \(topic.totalCount)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    ProgressView(
                        value: Double(topic.correctCount),
                        total: Double(max(topic.totalCount, 1))
                    )
                    .tint(Color("AccentColor"))
                    if let recommendation = attempt.metadata.recommendations?[topic.topic] {
                        Text(recommendation)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    private func englishFeedback(_ english: EnglishAssessmentResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("result_review_heading")
                .font(.title3.bold())
            Text("result_review_note")
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(Array(english.feedback.enumerated()), id: \.element.questionId) { index, item in
                feedbackRow(index: index, item: item)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    private func feedbackRow(index: Int, item: EnglishFeedbackItem) -> some View {
        let question = attempt.questions.first(where: { $0.id == item.questionId })
        return DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                if let passage = question?.passage {
                    Text(passage)
                        .font(.footnote)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
                }
                if let prompt = question?.prompt {
                    Text(prompt)
                        .font(.subheadline.weight(.medium))
                }
                if let selectedId = item.selectedOptionId,
                   let selected = question?.options.first(where: { $0.id == selectedId })?.label {
                    Text(String(format: String(localized: "result_your_answer"), selected))
                        .font(.footnote)
                }
                if let correct = question?.options.first(where: { $0.id == item.correctOptionId })?.label {
                    Text(String(format: String(localized: "result_correct_answer"), correct))
                        .font(.footnote)
                }
                Text(item.explanation)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 6)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: item.correct ? "checkmark.circle.fill" : "xmark.circle")
                    .foregroundStyle(item.correct ? Color.green : Color("AccentColor"))
                Text("\(index + 1). \(topicLabel(item.topic))")
                    .font(.subheadline)
            }
        }
    }

    private func topicLabel(_ topic: String) -> String {
        switch topic {
        case "grammar": return String(localized: "result_topic_grammar")
        case "vocabulary": return String(localized: "result_topic_vocabulary")
        case "reading": return String(localized: "result_topic_reading")
        default: return topic
        }
    }

    // MARK: - ORVIS

    private func orvisScales(_ orvis: OrvisAssessmentResult) -> some View {
        let sorted = orvis.scales.sorted(by: { $0.mean > $1.mean })
        return VStack(alignment: .leading, spacing: 12) {
            Text("result_orvis_scales_heading")
                .font(.title3.bold())
            ForEach(sorted, id: \.scale) { scale in
                let meta = attempt.metadata.scales?.first(where: { $0.id == scale.scale })
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(meta?.label ?? scale.scale)
                            .font(.subheadline.weight(.medium))
                        Spacer()
                        Text(String(format: "%.2f / 5", scale.mean))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    ProgressView(value: max(scale.mean - 1, 0), total: 4)
                        .tint(Color("AccentColor"))
                    if let description = meta?.description {
                        Text(description)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder
    private func orvisProfessions(_ orvis: OrvisAssessmentResult) -> some View {
        if let professions = attempt.metadata.professions, !professions.isEmpty {
            let top = Set(orvis.topScales)
            let preferred = professions.filter { profession in
                profession.scaleIds?.contains(where: top.contains) ?? false
            }
            let shown = preferred.isEmpty ? professions : preferred
            VStack(alignment: .leading, spacing: 12) {
                Text("result_professions_heading")
                    .font(.title3.bold())
                Text("result_professions_note")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let attribution = attempt.metadata.professionAttribution {
                    Text(attribution)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                ForEach(shown) { profession in
                    professionRow(profession)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private func professionRow(_ profession: AssessmentProfession) -> some View {
        DisclosureGroup {
            VStack(alignment: .leading, spacing: 8) {
                Text(profession.summary)
                    .font(.footnote)
                if let tasks = profession.tasks, !tasks.isEmpty {
                    Text("result_profession_tasks")
                        .font(.footnote.weight(.semibold))
                    ForEach(tasks, id: \.self) { task in
                        Text("• \(task)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                if let directions = profession.studyDirections, !directions.isEmpty {
                    Text(String(
                        format: String(localized: "result_profession_study"),
                        directions.joined(separator: " · ")
                    ))
                    .font(.footnote)
                }
                if let activity = profession.tryActivity {
                    Text(String(format: String(localized: "result_profession_try"), activity))
                        .font(.footnote)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
                }
                if let note = profession.editorialNote {
                    Text(note)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if let source = profession.source {
                    Text("O*NET® \(source.occupationId), \(source.version) · \(source.license)")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.top, 6)
        } label: {
            Text(profession.title)
                .font(.subheadline.weight(.medium))
        }
    }

    // MARK: - Limitations

    @ViewBuilder
    private var limitations: some View {
        if let limitations = attempt.metadata.limitations, !limitations.isEmpty {
            DisclosureGroup("result_limitations_heading") {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(limitations, id: \.self) { line in
                        Text("• \(line)")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 6)
            }
            .font(.subheadline.weight(.medium))
            .padding(16)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))
        }
    }
}
