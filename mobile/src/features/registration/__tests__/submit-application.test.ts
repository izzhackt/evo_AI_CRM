/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock фабрики загружают модули лениво */
import { pendingAiConsentFromMetadata, registrationAiConsentChoice } from "@/features/registration/ai-consent";
import { METADATA_KEYS_TO_CLEAR, outcomeOfError, readMetadataSubmission, submitStudentApplication } from "@/features/registration/submit-application";
import { RpcError, type RpcTransport } from "@/lib/rpc";
import { REQUEST_ID, validDraft } from "@/test-fixtures/registration";

jest.mock("expo-crypto", () => ({
  randomUUID: () => require("node:crypto").randomUUID(),
  getRandomBytes: (size: number) => new Uint8Array(require("node:crypto").randomBytes(size)),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, text: string) => require("node:crypto").createHash("sha256").update(text).digest("hex"),
}));

type Call = { name: string; args: Record<string, unknown> | undefined };

function transport(handlers: Record<string, () => { data?: unknown; error?: { code?: string } | null; status?: number }>) {
  const calls: Call[] = [];
  const fn: RpcTransport = async (name, args) => {
    calls.push({ name, args: args as Record<string, unknown> | undefined });
    const handler = handlers[name];
    if (!handler) return { data: null, error: { code: "42883" }, status: 404 };
    const result = handler();
    return { data: result.data ?? null, error: result.error ?? null, status: result.status ?? 200 };
  };
  return { fn, calls };
}

describe("согласие на ИИ при регистрации", () => {
  it("номер запроса выводится из номера анкеты и стабилен (UUID v4-вида)", async () => {
    const a = await registrationAiConsentChoice(REQUEST_ID);
    const b = await registrationAiConsentChoice(REQUEST_ID.toUpperCase());
    expect(a).toEqual(b);
    expect(a.status).toBe("granted");
    expect(a.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("выбор из метаданных принимается только целым и по текущему тексту", async () => {
    const choice = await registrationAiConsentChoice(REQUEST_ID);
    expect(pendingAiConsentFromMetadata({ student_ai_consent_choice: choice })).toEqual(choice);
    expect(pendingAiConsentFromMetadata({ student_ai_consent_choice: { ...choice, policyVersion: "2020-01-01" } })).toBeNull();
    expect(pendingAiConsentFromMetadata({ student_ai_consent_choice: { ...choice, status: "declined" } })).toBeNull();
    expect(pendingAiConsentFromMetadata({ student_ai_consent_choice: { ...choice, requestId: "x" } })).toBeNull();
    expect(pendingAiConsentFromMetadata({})).toBeNull();
    expect(pendingAiConsentFromMetadata(null)).toBeNull();
  });
});

describe("submitStudentApplication", () => {
  const clear = () => {
    const state = { cleared: 0 };
    return { state, clearMetadata: async () => void (state.cleared += 1) };
  };

  it("отправляет RPC с p_request_id = requestId анкеты и expected_revision, затем согласие и очистку", async () => {
    const choice = await registrationAiConsentChoice(REQUEST_ID);
    const t = transport({
      submit_student_application_v1: () => ({ data: { id: "x" } }),
      portal_ai_consent_get_v1: () => ({ data: { status: null, policy_version: null, decided_at: null } }),
      portal_ai_consent_set_v1: () => ({ data: { status: "granted" } }),
    });
    const { state, clearMetadata } = clear();
    const outcome = await submitStudentApplication({ transport: t.fn, clearMetadata }, { draft: validDraft(), expectedRevision: 3, aiChoice: choice });
    expect(outcome).toBe("submitted");
    const submit = t.calls.find((c) => c.name === "submit_student_application_v1");
    expect(submit?.args).toEqual({ p_questionnaire: validDraft(), p_expected_revision: 3, p_request_id: REQUEST_ID });
    const consent = t.calls.find((c) => c.name === "portal_ai_consent_set_v1");
    expect(consent?.args).toMatchObject({ p_status: "granted", p_request_id: choice.requestId });
    expect(["ios", "portal_web"]).toContain(consent?.args?.p_source);
    expect(state.cleared).toBe(1);
  });

  it("уже принятое решение студента не перезаписывается", async () => {
    const t = transport({
      submit_student_application_v1: () => ({ data: {} }),
      portal_ai_consent_get_v1: () => ({ data: { status: "declined" } }),
    });
    const { clearMetadata } = clear();
    await submitStudentApplication({ transport: t.fn, clearMetadata }, { draft: validDraft(), expectedRevision: 0, aiChoice: await registrationAiConsentChoice(REQUEST_ID) });
    expect(t.calls.some((c) => c.name === "portal_ai_consent_set_v1")).toBe(false);
  });

  it.each([
    ["40001", 409, "conflict"],
    ["23505", 409, "conflict"],
    ["22023", 400, "invalid"],
    ["42501", 403, "forbidden"],
  ])("код %s -> %s", async (code, status, outcome) => {
    const t = transport({ submit_student_application_v1: () => ({ error: { code }, status }) });
    const { state, clearMetadata } = clear();
    expect(await submitStudentApplication({ transport: t.fn, clearMetadata }, { draft: validDraft(), expectedRevision: 0, aiChoice: null })).toBe(outcome);
    expect(state.cleared).toBe(0);
  });

  it("обрыв повторяет ТОТ ЖЕ запрос и не стирает черновик при отказе", async () => {
    let attempts = 0;
    const t = transport({
      submit_student_application_v1: () => {
        attempts += 1;
        return attempts < 3 ? { error: {}, status: 0 } : { data: {} };
      },
    });
    const { clearMetadata } = clear();
    expect(await submitStudentApplication({ transport: t.fn, clearMetadata }, { draft: validDraft(), expectedRevision: 0, aiChoice: null })).toBe("submitted");
    const ids = t.calls.filter((c) => c.name === "submit_student_application_v1").map((c) => c.args?.p_request_id);
    expect(new Set(ids)).toEqual(new Set([REQUEST_ID]));
    expect(ids).toHaveLength(3);
  });

  it("нет связи на всех попытках -> offline", async () => {
    const t = transport({ submit_student_application_v1: () => ({ error: {}, status: 0 }) });
    const { clearMetadata } = clear();
    expect(await submitStudentApplication({ transport: t.fn, clearMetadata }, { draft: validDraft(), expectedRevision: 0, aiChoice: null })).toBe("offline");
  });

  it("невалидная анкета не уходит на сервер", async () => {
    const t = transport({});
    const { clearMetadata } = clear();
    expect(await submitStudentApplication({ transport: t.fn, clearMetadata }, { draft: validDraft({ consent: false as never }), expectedRevision: 0, aiChoice: null })).toBe("invalid");
    expect(t.calls).toHaveLength(0);
  });

  it("сбой очистки метаданных не отменяет успех", async () => {
    const t = transport({ submit_student_application_v1: () => ({ data: {} }) });
    expect(await submitStudentApplication({ transport: t.fn, clearMetadata: async () => { throw new Error("x"); } }, { draft: validDraft(), expectedRevision: 0, aiChoice: null })).toBe("submitted");
  });
});

describe("черновик из метаданных (resumeSubmit)", () => {
  it("читает валидный черновик и выбор согласия, невалидный игнорирует", async () => {
    const choice = await registrationAiConsentChoice(REQUEST_ID);
    const read = readMetadataSubmission({ student_application_draft: validDraft(), student_ai_consent_choice: choice });
    expect(read?.draft.requestId).toBe(REQUEST_ID);
    expect(read?.aiChoice).toEqual(choice);
    expect(readMetadataSubmission({ student_application_draft: { ...validDraft(), consent: false } })).toBeNull();
    expect(readMetadataSubmission({})).toBeNull();
    expect(readMetadataSubmission(undefined)).toBeNull();
  });

  it("очистка стирает оба ключа", () => {
    expect(METADATA_KEYS_TO_CLEAR).toEqual({ student_application_draft: null, student_ai_consent_choice: null });
  });

  it("классы ошибок RPC", () => {
    expect(outcomeOfError(new RpcError("transport"))).toBe("offline");
    expect(outcomeOfError(new RpcError("server", null, 500))).toBe("server");
    expect(outcomeOfError(new RpcError("rate_limited"))).toBe("rate_limited");
    expect(outcomeOfError(new Error("x"))).toBe("unknown");
  });
});
