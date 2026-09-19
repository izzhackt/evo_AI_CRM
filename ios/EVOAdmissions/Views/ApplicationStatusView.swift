import SwiftUI

/// PORT-9a: экран статуса заявки — зеркало /apply/status
/// (ApplicationStatus.tsx): заголовок и лид по статусу, причина отказа,
/// «Исправить анкету» для rejected, «Обновить статус»/«Открыть кабинет»
/// (refresh session + повторный resolve), выход и список ответов анкеты.
struct ApplicationStatusView: View {
    @ObservedObject var router: SessionRouter
    let application: StudentApplication

    @State private var isChecking = false

    private var titleKey: String {
        switch application.status {
        case .approved: return "apply_status_approved_title"
        case .rejected: return "apply_status_rejected_title"
        case .pending: return "apply_status_pending_title"
        }
    }

    private var leadKey: String {
        switch application.status {
        case .approved: return "apply_status_approved_lead"
        case .rejected: return "apply_status_rejected_lead"
        case .pending: return "apply_status_pending_lead"
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("apply_status_kicker")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                Text(LocalizedStringKey(titleKey))
                    .font(.title.bold())
                Text(LocalizedStringKey(leadKey))
                    .font(.body)
                    .foregroundStyle(.secondary)
                if let reason = application.decisionReason, !reason.isEmpty {
                    Text(reason)
                        .font(.subheadline)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color(.secondarySystemBackground)))
                        .accessibilityLabel(Text("apply_status_reason_label"))
                        .accessibilityValue(Text(reason))
                }

                actions

                Divider().padding(.vertical, 4)

                Text("apply_answers_heading")
                    .font(.title3.bold())
                Text(application.email)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                answersList
            }
            .padding(20)
        }
        .onAppear {
            // Черновики этой заявки больше не нужны — как очистка
            // sessionStorage на статусе (ApplicationStatus.tsx:47-54).
            UserDefaults.standard.removeObject(forKey: "evo-application-draft-v1")
            UserDefaults.standard.removeObject(
                forKey: "evo-application-draft-v1:\(application.email):\(application.revision - 1)"
            )
        }
    }

    @ViewBuilder private var actions: some View {
        VStack(alignment: .leading, spacing: 10) {
            if application.status == .rejected {
                Button {
                    router.startResubmit(from: application)
                } label: {
                    Text("apply_fix_application")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .accessibilityLabel(Text("apply_fix_application"))
            } else {
                Button {
                    Task {
                        isChecking = true
                        await router.refreshApplicationStatus()
                        isChecking = false
                    }
                } label: {
                    Group {
                        if isChecking {
                            ProgressView()
                        } else {
                            Text(application.status == .approved
                                 ? "apply_open_cabinet"
                                 : "apply_refresh_status")
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color("AccentColor"))
                .disabled(isChecking)
                .accessibilityLabel(Text(application.status == .approved
                                         ? "apply_open_cabinet"
                                         : "apply_refresh_status"))
            }
            Button("apply_logout") {
                Task { await router.signOut() }
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel(Text("apply_logout"))
        }
    }

    /// localizedAnswers parity (ApplicationStatus.tsx:21-42): 12 строк, те же
    /// подписи и та же локализованная сборка значений.
    private var answers: [(label: String, value: String)] {
        let draft = application.questionnaire
        let english: String
        switch draft.english {
        case let .exam(exam, score):
            let scoreText = score.truncatingRemainder(dividingBy: 1) == 0
                ? String(Int(score))
                : String(score)
            english = String(
                format: applyString("apply_english_exam_answer"),
                applyOptionLabel(exam), scoreText
            )
        case let .selfAssessed(level):
            english = String(
                format: applyString("apply_english_self_answer"),
                applyOptionLabel(level)
            )
        }
        let grade = draft.averageGrade.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(draft.averageGrade))
            : String(draft.averageGrade)
        return [
            (applyString("apply_answer_name"), "\(draft.firstName) \(draft.lastName)"),
            (applyString("apply_answer_phone"), draft.phone),
            (applyString("apply_answer_countries"),
             draft.destinationCountries.map(applyCountryName).joined(separator: ", ")),
            (applyString("apply_answer_intake"),
             "\(applyOptionLabel(draft.intakeSeason)) \(draft.intakeYear)"),
            (applyString("apply_answer_education"), applyOptionLabel(draft.educationLevel)),
            (applyString("apply_answer_grade"),
             String(format: applyString("apply_grade_of"), grade, draft.gradeScale)),
            (applyString("apply_answer_fields"),
             draft.studyFields.map(applyFieldLabel).joined(separator: ", ")),
            (applyString("apply_answer_levels"),
             draft.studyLevels.map(applyOptionLabel).joined(separator: ", ")),
            (applyString("apply_answer_nationality"), applyCountryName(draft.nationality)),
            (applyString("apply_answer_english"), english),
            (applyString("apply_answer_budget"), applyOptionLabel(draft.tuitionBudget)),
            (applyString("apply_answer_funding"), applyOptionLabel(draft.fundingSource)),
        ]
    }

    private var answersList: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(answers, id: \.label) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.label)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text(item.value)
                        .font(.subheadline.weight(.medium))
                }
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                Divider()
            }
        }
    }
}
