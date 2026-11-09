// Полная своя анкета (own_student_application_v1) для экрана статуса и исправления.
// Строго: форма ответа проверяется, чужая форма = сбой сервера, а не выдуманные данные.
import { RpcError, rpcRead, type RpcTransport } from "@/lib/rpc";
import { isStudentApplicationUuid, validateStudentApplicationDraft, type StudentApplicationDraft } from "@/features/registration/application-contract";

export type FullApplication = Readonly<{
  id: string;
  status: "pending" | "approved" | "rejected";
  revision: number;
  email: string;
  questionnaire: StudentApplicationDraft;
  submittedAt: string;
  decisionReason: string | null;
}>;

const isRow = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function decodeFullApplication(value: unknown): FullApplication | null {
  if (value === null || value === undefined) return null;
  if (!isRow(value)) throw new RpcError("unknown");
  const questionnaire = validateStudentApplicationDraft(value.questionnaire);
  const { id, status, revision, email, submitted_at: submittedAt, decision_reason: reason } = value;
  if (
    !questionnaire ||
    !isStudentApplicationUuid(id) ||
    (status !== "pending" && status !== "approved" && status !== "rejected") ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    typeof email !== "string" ||
    typeof submittedAt !== "string"
  ) {
    throw new RpcError("unknown");
  }
  return { id, status, revision, email, questionnaire, submittedAt, decisionReason: typeof reason === "string" && reason.trim() !== "" ? reason.trim() : null };
}

export async function readOwnApplication(transport: RpcTransport): Promise<FullApplication | null> {
  return decodeFullApplication(await rpcRead(transport, "own_student_application_v1"));
}
