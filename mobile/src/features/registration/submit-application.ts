// Отправка анкеты вошедшим студентом: submit_student_application_v1 (S1, GRANT authenticated),
// затем запись согласия на ИИ и очистка черновика в user_metadata — как web submitStudentApplication
// и iPhone ApplicationIntake. Идемпотентно по p_request_id (= requestId анкеты).
import { pendingAiConsentFromMetadata, registrationAiConsentChoice, replayAiConsent, type AiConsentChoice } from "@/features/registration/ai-consent";
import { createWrite, RpcError, rpcWrite, type RpcTransport } from "@/lib/rpc";
import { STUDENT_APPLICATION_METADATA_KEY, STUDENT_AI_CONSENT_METADATA_KEY, validateStudentApplicationDraft, type StudentApplicationDraft } from "@/features/registration/application-contract";

export type SubmitOutcome = "submitted" | "conflict" | "invalid" | "forbidden" | "offline" | "server" | "rate_limited" | "unknown";

export function outcomeOfError(error: unknown): SubmitOutcome {
  if (!(error instanceof RpcError)) return "unknown";
  switch (error.kind) {
    case "transport":
      return "offline";
    case "server":
      return "server";
    case "forbidden":
      return "forbidden";
    case "invalid":
      return "invalid";
    case "conflict":
      return "conflict";
    case "rate_limited":
      return "rate_limited";
    default:
      return "unknown";
  }
}

export type SubmitDeps = Readonly<{
  transport: RpcTransport;
  /** Стереть черновик и выбор согласия из user_metadata. Ошибка не мешает: анкета уже сохранена. */
  clearMetadata: () => Promise<void>;
}>;

/**
 * `aiChoice` — согласие на ИИ: из метаданных регистрации или из галочки мастера.
 * Если `aiChoice` не задан и `aiFromRequestId` включён, номер выводится из номера анкеты.
 */
export async function submitStudentApplication(
  deps: SubmitDeps,
  input: Readonly<{ draft: StudentApplicationDraft; expectedRevision: number; aiChoice: AiConsentChoice | null }>,
): Promise<SubmitOutcome> {
  if (!validateStudentApplicationDraft(input.draft) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return "invalid";
  try {
    const write = createWrite(
      "submit_student_application_v1",
      { p_questionnaire: input.draft, p_expected_revision: input.expectedRevision },
      { requestId: input.draft.requestId },
    );
    await rpcWrite(deps.transport, write, { wait: (attempt) => new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1))) });
  } catch (error) {
    return outcomeOfError(error);
  }
  // Анкета сохранена. Сбой дальше её не отменяет: согласие спросит карточка кабинета.
  if (input.aiChoice) await replayAiConsent(deps.transport, input.aiChoice);
  try {
    await deps.clearMetadata();
  } catch {
    // следующий вход увидит свою анкету и пойдёт на статус
  }
  return "submitted";
}

/** Черновик и выбор согласия, оставленные регистрацией в user_metadata (для «resumeSubmit»). */
export function readMetadataSubmission(metadata: unknown): { draft: StudentApplicationDraft; aiChoice: AiConsentChoice | null } | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const draft = validateStudentApplicationDraft((metadata as Record<string, unknown>)[STUDENT_APPLICATION_METADATA_KEY]);
  if (!draft) return null;
  return { draft, aiChoice: pendingAiConsentFromMetadata(metadata) };
}

export const METADATA_KEYS_TO_CLEAR = { [STUDENT_APPLICATION_METADATA_KEY]: null, [STUDENT_AI_CONSENT_METADATA_KEY]: null } as const;

export { registrationAiConsentChoice };
