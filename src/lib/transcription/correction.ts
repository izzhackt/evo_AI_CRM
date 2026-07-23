export type RawTranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type TranscriptCorrectionResult = {
  correctedTranscript: string;
  correctionReport: string[];
  uncertainPhrases: string[];
  segments: Array<{
    start: number;
    end: number;
    rawText: string;
    correctedText: string;
    confidence: "high" | "medium" | "low";
    notes: string;
  }>;
};

const CORRECTION_SYSTEM = `You correct ASR transcripts for Evo Admissions sales calls.

The audio is from Bishkek, Kyrgyzstan. Speakers are usually:
- Seller / Evo Admissions manager
- Potential customer, parent, student, or lead

Languages are usually Russian with Kyrgyz phrases. Preserve the original meaning.
You are not listening to audio. Do not invent facts.

Critical rules:
- Keep the raw transcript as the source of truth.
- Correct only likely ASR mistakes, punctuation, casing, obvious brand/domain terms, and readability.
- Do not change phone numbers, prices, dates, ages, universities, city names, personal names, or promises unless the correction is obvious from context.
- Do not add sales promises, guarantees, prices, deadlines, scholarships, visas, or outcomes.
- Preserve Kyrgyz words when likely spoken. Do not translate everything into Russian.
- Mark uncertain words as [unclear] instead of guessing.
- Return only valid JSON.`;

const ZAI_CORRECTION_MODEL = "glm-5.2";
const MAX_CORRECTION_SEGMENTS = 10_000;
const MAX_CORRECTION_TEXT_CHARS = 1_000_000;
const ZAI_CODING_PLAN_BASE_URL =
  process.env.ZAI_CODING_PLAN_BASE_URL || "https://api.z.ai/api/coding/paas/v4";

const DOMAIN_CONTEXT = `Domain context and glossary:
- Correct brand spelling: EVO Admissions.
- Location context: Bishkek / Бишкек, Kyrgyzstan / Кыргызстан, Central Asia.
- Business: education consulting for admissions abroad.
- Common topics: поступление, зарубежные университеты, консультация, документы, мотивационное письмо, виза, грант, стипендия, выставка, мероприятие, заявка, форма, Instagram, WhatsApp.
- Common Kyrgyz/Russian phrases:
  - саламатсызбы / саламатсыздарбы = hello
  - макул = okay
  - рахмат = thank you
  - көргөзмө = exhibition
  - байланыш / байланышып = contact
  - кайсы шаарда = in which city
  - Бишкек = Bishkek
- Known likely ASR mistakes:
  - Эва Дмишинс, Эва адмишнс, Eva Dmissions -> EVO Admissions
  - Бешкек -> Бишкек
  - заявкам подоставляли -> заявку оставляли, only if sentence clearly means lead/request
  - Дубай День / Дубай Дэн -> Dubai event / мероприятие в Дубае, only if clear

Output JSON shape:
{
  "correctedTranscript": "full cleaned transcript, one readable line per turn or segment",
  "correctionReport": ["short bullet strings explaining important fixes"],
  "uncertainPhrases": ["short phrases that remain uncertain"],
  "segments": [
    {
      "start": 0.0,
      "end": 1.2,
      "rawText": "raw segment text",
      "correctedText": "corrected segment text",
      "confidence": "high | medium | low",
      "notes": "short reason or empty string"
    }
  ]
}`;

function extractJsonObject(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("correction_json_missing");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as TranscriptCorrectionResult;
}

function zAiApiKey() {
  return process.env.ZAI_API_KEY || process.env.Z_AI_API_KEY || process.env.ZAI_CODING_PLAN_API_KEY;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function extractZaiMessageContent(payload: unknown) {
  const response = payload as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ type?: string; text?: string }>;
      };
    }>;
  };
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" || !part.type ? part.text || "" : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchZaiCorrection(prompt: string, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  let response: Response;
  try {
    response = await fetch(`${normalizeBaseUrl(ZAI_CODING_PLAN_BASE_URL)}/chat/completions`, {
      method: "POST",
      headers: {
        "Accept-Language": "en-US,en",
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ZAI_CORRECTION_MODEL,
        messages: [
          { role: "system", content: CORRECTION_SYSTEM },
          { role: "user", content: prompt },
        ],
        thinking: { type: "disabled" },
        reasoning_effort: "none",
        do_sample: false,
        max_tokens: 4096,
        stream: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("zai_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();
  if (!response.ok) {
    console.error("Z.ai correction request failed:", response.status);
    if (response.status === 429 || response.status >= 500) {
      throw new Error("zai_overloaded");
    }
    throw new Error("zai_error");
  }

  return responseText;
}

async function callZaiCorrection(prompt: string) {
  const apiKey = zAiApiKey();
  if (!apiKey) throw new Error("not_configured");

  let responseText = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      responseText = await fetchZaiCorrection(prompt, apiKey);
      break;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "zai_overloaded" || attempt === 2) {
        throw error;
      }
      await wait([2_000, 6_000][attempt] ?? 10_000);
    }
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error("zai_invalid_response");
  }

  const text = extractZaiMessageContent(payload);
  if (!text) throw new Error("zai_empty_response");
  return text;
}

function normalizeCorrection(
  parsed: TranscriptCorrectionResult,
  rawSegments: RawTranscriptSegment[],
): TranscriptCorrectionResult {
  const segments = Array.isArray(parsed.segments) ? parsed.segments : [];
  return {
    correctedTranscript: String(parsed.correctedTranscript || "").trim(),
    correctionReport: Array.isArray(parsed.correctionReport)
      ? parsed.correctionReport.map(String).filter(Boolean)
      : [],
    uncertainPhrases: Array.isArray(parsed.uncertainPhrases)
      ? parsed.uncertainPhrases.map(String).filter(Boolean)
      : [],
    segments: rawSegments.map((raw, index) => {
      const corrected = segments[index];
      const confidence = corrected?.confidence;
      return {
        start: raw.start,
        end: raw.end,
        rawText: raw.text,
        correctedText: String(corrected?.correctedText || raw.text).trim(),
        confidence: confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : "low",
        notes: String(corrected?.notes || "").trim(),
      };
    }),
  };
}

export async function correctTranscriptWithContext(input: {
  audioName: string;
  model: string;
  language?: string | null;
  segments: RawTranscriptSegment[];
}) {
  if (
    input.segments.length === 0 ||
    input.segments.length > MAX_CORRECTION_SEGMENTS ||
    input.segments.reduce((total, segment) => total + segment.text.length, 0) > MAX_CORRECTION_TEXT_CHARS
  ) {
    throw new Error("correction_input_too_large");
  }
  const prompt = `${DOMAIN_CONTEXT}

Transcript metadata:
- Audio: ${input.audioName}
- ASR model: ${input.model}
- Detected language: ${input.language ?? "unknown"}

Raw timestamped transcript JSON:
${JSON.stringify(input.segments, null, 2)}`;

  const text = await callZaiCorrection(prompt);
  return normalizeCorrection(extractJsonObject(text), input.segments);
}
