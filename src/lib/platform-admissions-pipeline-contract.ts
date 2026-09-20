/**
 * OTH-1 «Воронка поступления» — client-safe contract: stage/tab dictionaries
 * and row shapes shared by the board client component and the server module.
 * MUST stay free of any server-only import (supabase/server is traced into
 * the client bundle otherwise — the Build gate enforces it).
 */
/** The 9 kanban columns, in board order (tab 1 then tab 2). */
export const ADMISSIONS_PIPELINE_STAGES = [
  "new",
  "shortlist",
  "documents",
  "ready_to_submit",
  "awaiting_decision",
  "confirmed",
  "visa",
  "predeparture",
  "arrived",
] as const;
export type AdmissionsPipelineStage = (typeof ADMISSIONS_PIPELINE_STAGES)[number];

export type AdmissionsPipelineTab = "admission" | "visa";

export const ADMISSIONS_PIPELINE_TAB_STAGES: Readonly<
  Record<AdmissionsPipelineTab, readonly AdmissionsPipelineStage[]>
> = Object.freeze({
  admission: ["new", "shortlist", "documents", "ready_to_submit", "awaiting_decision"],
  visa: ["confirmed", "visa", "predeparture", "arrived"],
});

export function admissionsPipelineTabOf(stage: AdmissionsPipelineStage): AdmissionsPipelineTab {
  return ADMISSIONS_PIPELINE_TAB_STAGES.admission.includes(stage) ? "admission" : "visa";
}

export type AdmissionsPipelineRow = Readonly<{
  studentCaseId: string;
  studentDisplayName: string;
  targetCountry: string | null;
  primaryInstitutionName: string | null;
  currentCuratorMembershipId: string | null;
  currentCuratorDisplayName: string | null;
  pipelineStage: AdmissionsPipelineStage;
  awaitingAck: boolean;
  overdue: boolean;
  /** OTH-5: the case's per-case chat thread has await_state='needs_reply'. */
  needsReply: boolean;
}>;

export type AdmissionsPipelineBoard = Readonly<{
  rows: readonly AdmissionsPipelineRow[];
  /** Honest truncation: true only when the read actually stopped at the 400-row cap. */
  truncated: boolean;
}>;

export type AdmissionsPipelineBoardFilters = Readonly<{
  curatorMembershipId?: string | null;
  country?: string | null;
  query?: string | null;
}>;
