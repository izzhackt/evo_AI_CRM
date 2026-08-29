// Preserve line breaks for readable WhatsApp drafts while rejecting every
// other ASCII control character after CRLF has been normalized to LF.
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0009\u000b-\u001f\u007f]/;
const MAX_PROVIDER_OUTPUT_BYTES = 16_384;
const MAX_REPLY_TEXT_LENGTH = 3_000;
const UNSAFE_OUTCOME_PATTERNS = [
  /\b100\s*%/iu,
  /\bguarantee(?:d|s)?\b/iu,
  /\bdefinitely\s+(?:admitted|approved|receive|win)\b/iu,
  /гарант(?:ируем|ирован|ия|ировать)/iu,
  /точно\s+(?:поступите|получите|одобрят)/iu,
  /без\s+риска/iu,
] as const;

export const CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION =
  "evo-gemini-proposal-v1" as const;

export const CANONICAL_GEMINI_PROPOSAL_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "reply_text"],
  properties: {
    schema_version: {
      type: "string",
      enum: [CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION],
    },
    reply_text: {
      type: "string",
      minLength: 1,
      maxLength: MAX_REPLY_TEXT_LENGTH,
    },
  },
} as const);

export type CanonicalGeminiProposalOutputErrorCode =
  | "malformed_json"
  | "invalid_shape"
  | "unsafe_semantics";

export class CanonicalGeminiProposalOutputError extends Error {
  readonly code: CanonicalGeminiProposalOutputErrorCode;

  constructor(code: CanonicalGeminiProposalOutputErrorCode) {
    super("Gemini proposal output was rejected by EVO validation.");
    this.name = "CanonicalGeminiProposalOutputError";
    this.code = code;
  }
}

export type CanonicalGeminiProposalOutput = Readonly<{
  schemaVersion: typeof CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION;
  replyText: string;
}>;

function invalidShape(): never {
  throw new CanonicalGeminiProposalOutputError("invalid_shape");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCanonicalGeminiProposalOutput(
  rawOutput: unknown,
): CanonicalGeminiProposalOutput {
  if (
    typeof rawOutput !== "string" ||
    rawOutput.trim().length === 0 ||
    Buffer.byteLength(rawOutput, "utf8") > MAX_PROVIDER_OUTPUT_BYTES
  ) {
    return invalidShape();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw new CanonicalGeminiProposalOutputError("malformed_json");
  }
  if (!isRecord(parsed)) return invalidShape();

  const keys = Object.keys(parsed).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "reply_text" ||
    keys[1] !== "schema_version" ||
    parsed.schema_version !== CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION ||
    typeof parsed.reply_text !== "string"
  ) {
    return invalidShape();
  }

  const replyText = parsed.reply_text.replace(/\r\n?/g, "\n").trim();
  if (
    replyText.length === 0 ||
    replyText.length > MAX_REPLY_TEXT_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(replyText)
  ) {
    return invalidShape();
  }
  if (UNSAFE_OUTCOME_PATTERNS.some((pattern) => pattern.test(replyText))) {
    throw new CanonicalGeminiProposalOutputError("unsafe_semantics");
  }

  return Object.freeze({
    schemaVersion: CANONICAL_GEMINI_PROPOSAL_SCHEMA_VERSION,
    replyText,
  });
}
