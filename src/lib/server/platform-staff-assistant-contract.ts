const encoder = new TextEncoder();
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const PLATFORM_STAFF_ASSISTANT_MAX_BODY_BYTES = 65_536;
export const PLATFORM_STAFF_ASSISTANT_MAX_TEXT_BYTES = 4_000;
export const PLATFORM_STAFF_ASSISTANT_MAX_TRANSCRIPT_BYTES = 32_000;
export const PLATFORM_STAFF_ASSISTANT_MAX_REPLY_BYTES = 16_384;

export type PlatformStaffAssistantInput =
  | Readonly<{
      audience: "client";
      turns: readonly Readonly<{ role: "user" | "assistant"; content: string }>[];
      evaluationCaseId: "client_china_documents" | null;
      latestQuestion: string;
    }>
  | Readonly<{
      audience: "internal";
      question: string;
      evaluationCaseId: "internal_malaysia_handoff" | null;
      latestQuestion: string;
    }>;

export type PlatformStaffAssistantResult = Readonly<{
  reply: string;
  handoff: boolean;
  sources: readonly Readonly<{ chunk_id: string; source_path: string }>[];
  audit_id: string;
}>;

export class PlatformStaffAssistantContractError extends Error {
  constructor() {
    super("Invalid staff assistant contract");
    this.name = "PlatformStaffAssistantContractError";
  }
}

function invalid(): never {
  throw new PlatformStaffAssistantContractError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value).sort();
  const allowed = [...required, ...optional].sort();
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.includes(key));
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const normalized = value.normalize("NFC").trim();
  const bytes = encoder.encode(normalized).byteLength;
  if (bytes < 1 || bytes > PLATFORM_STAFF_ASSISTANT_MAX_TEXT_BYTES) return invalid();
  return normalized;
}

export function normalizePlatformStaffAssistantInput(value: unknown): PlatformStaffAssistantInput {
  if (!isRecord(value) || typeof value.audience !== "string") return invalid();

  if (value.audience === "client") {
    if (!exactKeys(value, ["audience", "turns"], ["evaluation_case_id"])) return invalid();
    if (!Array.isArray(value.turns) || value.turns.length < 1 || value.turns.length > 20 || value.turns.length % 2 === 0) {
      return invalid();
    }
    const turns = value.turns.map((turn, index) => {
      if (!isRecord(turn) || !exactKeys(turn, ["role", "content"])) return invalid();
      const expectedRole = index % 2 === 0 ? "user" : "assistant";
      if (turn.role !== expectedRole) return invalid();
      return Object.freeze({ role: expectedRole, content: normalizeText(turn.content) });
    });
    const transcriptBytes = turns.reduce((total, turn) => total + encoder.encode(turn.content).byteLength, 0);
    if (transcriptBytes > PLATFORM_STAFF_ASSISTANT_MAX_TRANSCRIPT_BYTES) return invalid();
    const evaluationCaseId = value.evaluation_case_id ?? null;
    if (evaluationCaseId !== null && evaluationCaseId !== "client_china_documents") return invalid();
    return Object.freeze({
      audience: "client",
      turns: Object.freeze(turns),
      evaluationCaseId,
      latestQuestion: turns.at(-1)!.content,
    });
  }

  if (value.audience === "internal") {
    if (!exactKeys(value, ["audience", "question"], ["evaluation_case_id"])) return invalid();
    const question = normalizeText(value.question);
    const evaluationCaseId = value.evaluation_case_id ?? null;
    if (evaluationCaseId !== null && evaluationCaseId !== "internal_malaysia_handoff") return invalid();
    return Object.freeze({
      audience: "internal",
      question,
      evaluationCaseId,
      latestQuestion: question,
    });
  }

  return invalid();
}

export function normalizePlatformStaffAssistantResult(value: unknown): PlatformStaffAssistantResult {
  if (!isRecord(value) || !exactKeys(value, ["reply", "handoff", "sources", "audit_id"])) return invalid();
  if (typeof value.reply !== "string" || typeof value.handoff !== "boolean") return invalid();
  const reply = value.reply.normalize("NFC").trim();
  if (!reply || encoder.encode(reply).byteLength > PLATFORM_STAFF_ASSISTANT_MAX_REPLY_BYTES) return invalid();
  if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 5) return invalid();
  const seen = new Set<string>();
  const sources = value.sources.map((source) => {
    if (!isRecord(source) || !exactKeys(source, ["chunk_id", "source_path"])) return invalid();
    if (typeof source.chunk_id !== "string" || !UUID_PATTERN.test(source.chunk_id) || seen.has(source.chunk_id)) return invalid();
    if (typeof source.source_path !== "string" || source.source_path.trim() !== source.source_path || encoder.encode(source.source_path).byteLength < 1 || encoder.encode(source.source_path).byteLength > 512) return invalid();
    seen.add(source.chunk_id);
    return Object.freeze({ chunk_id: source.chunk_id, source_path: source.source_path });
  });
  if (typeof value.audit_id !== "string" || !UUID_PATTERN.test(value.audit_id)) return invalid();
  return Object.freeze({ reply, handoff: value.handoff, sources: Object.freeze(sources), audit_id: value.audit_id });
}
