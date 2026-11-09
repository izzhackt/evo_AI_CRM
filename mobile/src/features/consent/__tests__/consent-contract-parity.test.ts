// Порт «Конфиденциальности» обязан совпадать с модулем веба (src/lib/portal/consent-gate.ts).
import * as port from "@/features/consent/consent-contract";

type Web = typeof port & { CONSENT_GATE_SOURCE: string };
// requireActual: тип веб-модуля не подключаем (tsc приложения не должен обходить серверный код).
const web = jest.requireActual("@web/lib/portal/consent-gate") as Web;

describe("версии совпадают с вебом", () => {
  it("Политика 2026-11-07 и текст ИИ 2026-10-25", () => {
    expect(port.PRIVACY_POLICY_VERSION).toBe(web.PRIVACY_POLICY_VERSION);
    expect(port.CONSENT_GATE_AI_POLICY_VERSION).toBe(web.CONSENT_GATE_AI_POLICY_VERSION);
    expect(port.PRIVACY_POLICY_VERSION).toBe("2026-11-07");
    expect(port.CONSENT_GATE_AI_POLICY_VERSION).toBe("2026-10-25");
  });
});

const base = {
  policyVersionCurrent: "2026-11-07",
  policyAcceptedVersion: null,
  aiStatus: null,
  aiPolicyVersion: null,
  aiPolicyVersionCurrent: "2026-10-25",
  needsDecision: true,
};
const samples: [string, unknown][] = [
  ["нет решения", base],
  ["принято", { ...base, policyAcceptedVersion: "2026-11-07", aiStatus: "granted", aiPolicyVersion: "2026-10-25", needsDecision: false }],
  ["отзыв ИИ", { ...base, policyAcceptedVersion: "2026-11-07", aiStatus: "declined", aiPolicyVersion: "2026-10-25", needsDecision: false }],
  ["версия базы новее (Политика)", { ...base, policyVersionCurrent: "2099-01-01" }],
  ["версия базы новее (ИИ)", { ...base, aiPolicyVersionCurrent: "2099-01-01" }],
  ["лишний ключ", { ...base, extra: 1 }],
  ["нет ключа", (({ needsDecision: _n, ...rest }) => rest)(base)],
  ["aiStatus без версии", { ...base, aiStatus: "granted" }],
  ["версия без aiStatus", { ...base, aiPolicyVersion: "2026-10-25" }],
  ["чужой aiStatus", { ...base, aiStatus: "maybe", aiPolicyVersion: "2026-10-25" }],
  ["needsDecision не boolean", { ...base, needsDecision: "yes" }],
  ["версия с мусором", { ...base, policyVersionCurrent: "2026 11 07" }],
  ["массив", []],
  ["null", null],
  ["строка", "x"],
];

describe("разбор ответа и правило показа совпадают с вебом", () => {
  it.each(samples)("%s", (_name, value) => {
    const mine = port.parseConsentStatus(value);
    expect(mine).toEqual(web.parseConsentStatus(value));
    if (mine) expect(port.consentGateRequired(mine)).toBe(web.consentGateRequired(mine));
  });
});
