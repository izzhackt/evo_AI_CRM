import Foundation
import Supabase

/// CSCA RPCs (migrations 285 and 286, `docs/portal/csca-contract.md` §2),
/// kept in their own file so the shared `SupabaseService` is not edited.
/// Responses are decoded from the raw body by the strict `CSCADecoder`, the
/// same path the unit tests run on real demo responses. Every failure comes
/// out as `CSCAServiceError` with a classified `CSCAFailure`; server texts
/// and payloads never reach the UI or logs.
struct CSCAServiceError: Error, Equatable {
    let failure: CSCAFailure
}

/// A decoded response plus the `CSCAMonotonic` reading when it arrived,
/// for the test clock (never the device wall clock).
struct CSCATimed<Value> {
    let value: Value
    let receivedAt: TimeInterval
}

extension SupabaseService {
    static let cscaMathTrack = "csca-math"

    private func cscaCall<Params: Encodable & Sendable, Value: Decodable>(
        _ function: String,
        _ params: Params,
        as type: Value.Type
    ) async throws -> CSCATimed<Value> {
        let data: Data
        do {
            data = try await client.rpc(function, params: params).execute().data
        } catch let error as PostgrestError {
            throw CSCAServiceError(failure: CSCAFailure.classify(
                code: error.code, message: error.message, isTransport: false
            ))
        } catch is URLError {
            throw CSCAServiceError(failure: .network)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw CSCAServiceError(failure: .network)
        }
        let receivedAt = CSCAMonotonic.now()
        do {
            return CSCATimed(value: try CSCADecoder.decode(Value.self, from: data), receivedAt: receivedAt)
        } catch {
            // Contract drift: the client cannot render what it cannot decode.
            throw CSCAServiceError(failure: .invalid)
        }
    }

    // MARK: Reads

    func cscaHome(track: String = cscaMathTrack) async throws -> CSCATimed<CSCAHome> {
        struct Params: Encodable, Sendable { let p_track: String }
        return try await cscaCall("learning_track_home_v1", Params(p_track: track), as: CSCAHome.self)
    }

    func cscaLesson(lessonId: UUID) async throws -> CSCALessonResponse {
        struct Params: Encodable, Sendable { let p_lesson_id: UUID }
        return try await cscaCall("learning_lesson_v2", Params(p_lesson_id: lessonId), as: CSCALessonResponse.self).value
    }

    func cscaTestAttempt(attemptId: UUID) async throws -> CSCATimed<CSCATestAttempt> {
        struct Params: Encodable, Sendable { let p_attempt_id: UUID }
        return try await cscaCall("learning_test_attempt_v1", Params(p_attempt_id: attemptId), as: CSCATestAttempt.self)
    }

    func cscaReview(track: String = cscaMathTrack) async throws -> CSCAReviewResponse {
        struct Params: Encodable, Sendable { let p_track: String }
        return try await cscaCall("learning_review_v2", Params(p_track: track), as: CSCAReviewResponse.self).value
    }

    func cscaProgress(track: String = cscaMathTrack) async throws -> CSCAProgress {
        struct Params: Encodable, Sendable { let p_track: String }
        return try await cscaCall("learning_track_progress_v1", Params(p_track: track), as: CSCAProgress.self).value
    }

    // MARK: Lesson and practice writes (198 RPCs, contract §6)

    func cscaStartLesson(lessonId: UUID, requestId: UUID) async throws -> CSCALessonAttempt {
        struct Params: Encodable, Sendable { let p_lesson_id: UUID; let p_request_id: UUID }
        return try await cscaCall(
            "start_learning_lesson_v1", Params(p_lesson_id: lessonId, p_request_id: requestId), as: CSCALessonAttempt.self
        ).value
    }

    func cscaSaveLessonAnswer(
        attemptId: UUID, expectedRevision: Int64, exerciseId: UUID, answer: CSCAItemAnswer, requestId: UUID
    ) async throws -> CSCALessonSaveReceipt {
        struct Params: Encodable, Sendable {
            let p_attempt_id: UUID
            let p_expected_revision: Int64
            let p_exercise_id: UUID
            let p_answer: CSCAItemAnswer
            let p_request_id: UUID
        }
        return try await cscaCall(
            "save_learning_answer_v1",
            Params(p_attempt_id: attemptId, p_expected_revision: expectedRevision, p_exercise_id: exerciseId,
                   p_answer: answer, p_request_id: requestId),
            as: CSCALessonSaveReceipt.self
        ).value
    }

    func cscaCompleteLesson(attemptId: UUID, expectedRevision: Int64, requestId: UUID) async throws -> CSCALessonAttempt {
        struct Params: Encodable, Sendable {
            let p_attempt_id: UUID
            let p_expected_revision: Int64
            let p_request_id: UUID
        }
        return try await cscaCall(
            "complete_learning_lesson_v1",
            Params(p_attempt_id: attemptId, p_expected_revision: expectedRevision, p_request_id: requestId),
            as: CSCALessonAttempt.self
        ).value
    }

    // MARK: Timed tests (contract §7)

    func cscaStartTest(formId: UUID, requestId: UUID) async throws -> CSCATimed<CSCATestAttempt> {
        struct Params: Encodable, Sendable { let p_form_id: UUID; let p_request_id: UUID }
        return try await cscaCall(
            "start_learning_test_v1", Params(p_form_id: formId, p_request_id: requestId), as: CSCATestAttempt.self
        )
    }

    func cscaSaveTest(
        attemptId: UUID, expectedRevision: Int64, state: CSCATestSaveState, requestId: UUID
    ) async throws -> CSCATimed<CSCATestSaveReceipt> {
        struct Params: Encodable, Sendable {
            let p_attempt_id: UUID
            let p_expected_revision: Int64
            let p_answers: [String: String]
            let p_flags: [String]
            let p_item_seconds: [String: Int]
            let p_request_id: UUID
        }
        return try await cscaCall(
            "save_learning_test_v1",
            Params(p_attempt_id: attemptId, p_expected_revision: expectedRevision, p_answers: state.answers,
                   p_flags: state.flags, p_item_seconds: state.itemSeconds, p_request_id: requestId),
            as: CSCATestSaveReceipt.self
        )
    }

    func cscaCompleteTest(attemptId: UUID, expectedRevision: Int64, requestId: UUID) async throws -> CSCATimed<CSCATestAttempt> {
        struct Params: Encodable, Sendable {
            let p_attempt_id: UUID
            let p_expected_revision: Int64
            let p_request_id: UUID
        }
        return try await cscaCall(
            "complete_learning_test_v1",
            Params(p_attempt_id: attemptId, p_expected_revision: expectedRevision, p_request_id: requestId),
            as: CSCATestAttempt.self
        )
    }

    // MARK: Review, report, target session (contract §8, §10, §11)

    func cscaRecordReview(
        track: String = cscaMathTrack, itemKey: String, answer: CSCAItemAnswer, requestId: UUID
    ) async throws -> CSCAReviewReceipt {
        struct Params: Encodable, Sendable {
            let p_track: String
            let p_item_key: String
            let p_answer: CSCAItemAnswer
            let p_request_id: UUID
        }
        return try await cscaCall(
            "record_learning_review_v1",
            Params(p_track: track, p_item_key: itemKey, p_answer: answer, p_request_id: requestId),
            as: CSCAReviewReceipt.self
        ).value
    }

    func cscaReportItem(
        track: String = cscaMathTrack, itemKey: String, message: String, requestId: UUID
    ) async throws -> CSCAReportReceipt {
        struct Params: Encodable, Sendable {
            let p_track: String
            let p_item_key: String
            let p_message: String
            let p_request_id: UUID
        }
        return try await cscaCall(
            "report_learning_item_v1",
            Params(p_track: track, p_item_key: itemKey, p_message: message, p_request_id: requestId),
            as: CSCAReportReceipt.self
        ).value
    }

    func cscaSetTargetSession(track: String = cscaMathTrack, sessionKey: String?) async throws -> CSCATargetSessionReceipt {
        /// `p_session_key` is sent as JSON null to clear: an omitted key
        /// would not match the function signature.
        struct Params: Encodable, Sendable {
            let p_track: String
            let p_session_key: String?

            enum CodingKeys: String, CodingKey { case p_track, p_session_key }

            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(p_track, forKey: .p_track)
                if let p_session_key {
                    try c.encode(p_session_key, forKey: .p_session_key)
                } else {
                    try c.encodeNil(forKey: .p_session_key)
                }
            }
        }
        return try await cscaCall(
            "set_learning_target_session_v1", Params(p_track: track, p_session_key: sessionKey),
            as: CSCATargetSessionReceipt.self
        ).value
    }
}

extension Error {
    /// The classified CSCA failure of any error thrown by the CSCA calls.
    var cscaFailure: CSCAFailure {
        (self as? CSCAServiceError)?.failure ?? .network
    }
}
