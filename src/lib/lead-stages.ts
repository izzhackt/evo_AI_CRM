export const EVO_AMO_PIPELINE_ID = 8148746;

export const LEAD_STAGE_DEFINITIONS = [
  { status: "processing_mp", labelRu: "В обработке МП", amoStatusId: 71543606 },
  { status: "qualified", labelRu: "Лид квалифицирован", amoStatusId: 75210174 },
  { status: "meeting_scheduled", labelRu: "Назначена встреча", amoStatusId: 75210178 },
  { status: "meeting_done", labelRu: "Встреча проведена", amoStatusId: 75210182 },
  { status: "contract_signed", labelRu: "Договор подписан", amoStatusId: 75210186 },
  { status: "no_request", labelRu: "Лиды без запроса", amoStatusId: 76047894 },
] as const;

export const LEAD_STATUSES = LEAD_STAGE_DEFINITIONS.map((stage) => stage.status) as [
  (typeof LEAD_STAGE_DEFINITIONS)[number]["status"],
  ...(typeof LEAD_STAGE_DEFINITIONS)[number]["status"][],
];
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_TERMINAL_STATUSES = ["contract_signed", "no_request"] as const satisfies readonly LeadStatus[];
export const LEAD_ACTIVE_STATUSES = LEAD_STATUSES.filter(
  (status) => !(LEAD_TERMINAL_STATUSES as readonly string[]).includes(status),
) as LeadStatus[];

export function isActiveLeadStatus(status: string): status is LeadStatus {
  return (LEAD_ACTIVE_STATUSES as readonly string[]).includes(status);
}
