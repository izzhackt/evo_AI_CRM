import type { AdmissionsAttention, AdmissionsDirection } from "@/lib/platform-admissions-playbook-contract";
import type { V3ProfileCaseDirectoryParams } from "@/lib/v3/profile-source";

export const DIRECTION_LABELS: Record<AdmissionsDirection | "unknown", string> = {
  CN: "Китай", MY: "Малайзия", EUROPE: "Европа", AE: "ОАЭ", TR: "Турция", unknown: "Не указано",
};
export const ATTENTION_LABELS: Record<AdmissionsAttention, string> = {
  overdue: "Есть просрочки", awaiting_partner: "Ждём партнёра", submitted: "Подано в университет",
  decisions: "Решения университета", visas: "Визовые дела", arrivals: "Поездка и прибытие",
  // Plan §7's own wording for the curator-facing state: «Ожидает принятия».
  awaiting_ack: "Ожидает принятия",
  // S3 (plan §7): a pending case with sale/handoff evidence after a declined
  // assignment — Admin needs to pick a new curator inside the same case.
  needs_curator: "Нужно назначить куратора",
};
export function withDocsSection(href: string, docsMode: boolean): string {
  if (!docsMode) return href;
  const url = new URL(href, "https://evo.invalid");
  url.searchParams.set("section", "docs");
  return `${url.pathname}?${url.searchParams}${url.hash}`;
}

export function admissionsDirectoryHref(params: V3ProfileCaseDirectoryParams, cursor?: Readonly<{ sortAt: string; id: string }>, docsMode = false): string {
  const query = new URLSearchParams();
  if (params.query) query.set("case_q", params.query);
  if (params.state) query.set("case_status", params.state);
  if (params.direction) query.set("direction", params.direction);
  if (params.curatorMembershipId) query.set("curator", params.curatorMembershipId);
  if (params.attention) query.set("attention", params.attention);
  if (cursor) { query.set("case_before_at", cursor.sortAt); query.set("case_before_id", cursor.id); }
  return withDocsSection(`/v3/profile${query.size ? `?${query}` : ""}`, docsMode);
}
