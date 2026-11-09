// Английский (движок обучения 198): модули, урок, запись ответов, повторение ошибок. Парсеры общие с
// вебом (@web/lib/portal/learning); запись замораживается (повтор тем же p_request_id).
import {
  parseLearningAttempt,
  parseLearningLessonView,
  parseLearningModules,
  parseLearningReview,
  parseLearningReviewCheck,
  parseLearningSaveResult,
  type LearningAnswer,
  type LearningAttempt,
  type LearningLessonView,
  type LearningModule,
  type LearningReviewCheck,
  type LearningReviewItem,
  type LearningSaveResult,
} from "@web/lib/portal/learning";

import { PortalDecodeError } from "@/domain/portal-source";
import { createWrite, rpcRead, rpcWrite, type FrozenWrite, type RpcTransport } from "@/lib/rpc";

function decoded<T>(parse: (value: unknown) => T, value: unknown): T {
  try {
    return parse(value);
  } catch {
    throw new PortalDecodeError();
  }
}

export const readEnglishModules = async (t: RpcTransport): Promise<LearningModule[]> => decoded(parseLearningModules, await rpcRead(t, "learning_modules_v1"));
export const readEnglishLesson = async (t: RpcTransport, lessonId: string): Promise<LearningLessonView> => decoded(parseLearningLessonView, await rpcRead(t, "learning_lesson_v1", { p_lesson_id: lessonId }));
export const readEnglishReview = async (t: RpcTransport, moduleId: string): Promise<LearningReviewItem[]> => decoded(parseLearningReview, await rpcRead(t, "learning_review_v1", { p_module_id: moduleId }));
/** Проверка повторения: ничего не пишет (серверная проверка ответа). */
export const checkEnglishReview = async (t: RpcTransport, exerciseId: string, answer: LearningAnswer): Promise<LearningReviewCheck> =>
  decoded(parseLearningReviewCheck, await rpcRead(t, "learning_review_check_v1", { p_exercise_id: exerciseId, p_answer: answer }));

export const startEnglishWrite = (lessonId: string, id?: string): FrozenWrite => createWrite("start_learning_lesson_v1", { p_lesson_id: lessonId }, { requestId: id });
export const answerEnglishWrite = (i: { attemptId: string; expectedRevision: number; exerciseId: string; answer: LearningAnswer }, id?: string): FrozenWrite =>
  createWrite("save_learning_answer_v1", { p_attempt_id: i.attemptId, p_expected_revision: i.expectedRevision, p_exercise_id: i.exerciseId, p_answer: i.answer }, { requestId: id });
export const completeEnglishWrite = (i: { attemptId: string; expectedRevision: number }, id?: string): FrozenWrite =>
  createWrite("complete_learning_lesson_v1", { p_attempt_id: i.attemptId, p_expected_revision: i.expectedRevision }, { requestId: id });

export const sendEnglishAttempt = async (t: RpcTransport, w: FrozenWrite): Promise<LearningAttempt> => decoded(parseLearningAttempt, await rpcWrite(t, w));
export const sendEnglishAnswer = async (t: RpcTransport, w: FrozenWrite): Promise<LearningSaveResult> => decoded(parseLearningSaveResult, await rpcWrite(t, w));
