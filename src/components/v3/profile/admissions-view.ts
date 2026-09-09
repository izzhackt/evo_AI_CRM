import type { AdmissionsAttention, AdmissionsDirection } from "@/lib/platform-admissions-playbook-contract";
import type { V3ProfileCaseDirectoryParams } from "@/lib/v3/profile-source";

export const DIRECTION_LABELS: Record<AdmissionsDirection | "unknown", string> = {
  CN: "Китай", MY: "Малайзия", EUROPE: "Европа", AE: "ОАЭ", TR: "Турция", unknown: "Не указано",
};
export const ATTENTION_LABELS: Record<AdmissionsAttention, string> = {
  overdue: "Есть просрочки", awaiting_partner: "Ждём партнёра", submitted: "Подано в университет",
  decisions: "Решения университета", visas: "Визовые дела", arrivals: "Поездка и прибытие", awaiting_ack: "Передача ещё не принята",
};
export function admissionsDirectoryHref(params: V3ProfileCaseDirectoryParams, cursor?: Readonly<{ sortAt: string; id: string }>): string {
  const query = new URLSearchParams();
  if (params.query) query.set("case_q", params.query);
  if (params.state) query.set("case_status", params.state);
  if (params.direction) query.set("direction", params.direction);
  if (params.curatorMembershipId) query.set("curator", params.curatorMembershipId);
  if (params.attention) query.set("attention", params.attention);
  if (cursor) { query.set("case_before_at", cursor.sortAt); query.set("case_before_id", cursor.id); }
  return `/v3/profile${query.size ? `?${query}` : ""}`;
}
