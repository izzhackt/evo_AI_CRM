import { CONSENT_GATE_AI_POLICY_VERSION, PRIVACY_POLICY_VERSION } from "@/features/consent/consent-contract";

import { acceptConsents, ConsentDecodeError, consentAcceptWrite } from "@/features/consent/consent-gate";
import { RpcError } from "@/lib/rpc";
import { fakeTransport, failure } from "@/test-fixtures/universities";

const accepted = {
  policyVersionCurrent: PRIVACY_POLICY_VERSION,
  policyAcceptedVersion: PRIVACY_POLICY_VERSION,
  aiStatus: "granted",
  aiPolicyVersion: CONSENT_GATE_AI_POLICY_VERSION,
  aiPolicyVersionCurrent: CONSENT_GATE_AI_POLICY_VERSION,
  needsDecision: false,
};

describe("запись принятия (portal_consents_accept_v1)", () => {
  it("версии, источник и p_request_id заморожены; обрыв повторяется тем же запросом", async () => {
    const write = consentAcceptWrite("ios");
    const { transport, calls } = fakeTransport({
      portal_consents_accept_v1: (_args: unknown, n: number) => (n === 1 ? new RpcError("transport") : accepted),
    });
    const status = await acceptConsents(transport, write);
    expect(status.needsDecision).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toEqual(calls[1]?.args);
    expect(calls[0]?.args).toEqual({
      p_policy_version: PRIVACY_POLICY_VERSION,
      p_ai_policy_version: CONSENT_GATE_AI_POLICY_VERSION,
      p_source: "ios",
      p_request_id: write.requestId,
    });
  });

  it("повтор после сбоя 500 той же замороженной записью шлёт тот же p_request_id (не новый)", async () => {
    const write = consentAcceptWrite("android");
    const { transport, calls } = fakeTransport({
      portal_consents_accept_v1: (_a: unknown, n: number) => (n === 1 ? failure("XX000", 500) : accepted),
    });
    await expect(acceptConsents(transport, write)).rejects.toBeInstanceOf(RpcError);
    await expect(acceptConsents(transport, write)).resolves.toMatchObject({ aiStatus: "granted" });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.args?.p_request_id).toBe(calls[0]?.args?.p_request_id);
  });

  it("ответ, не подтверждающий принятие, не считается успехом", async () => {
    for (const bad of [{ ...accepted, needsDecision: true }, { ...accepted, aiStatus: "declined" }, { ...accepted, policyAcceptedVersion: null }, { nope: 1 }, null]) {
      const { transport } = fakeTransport({ portal_consents_accept_v1: bad });
      await expect(acceptConsents(transport, consentAcceptWrite("ios"))).rejects.toBeInstanceOf(ConsentDecodeError);
    }
  });
});
