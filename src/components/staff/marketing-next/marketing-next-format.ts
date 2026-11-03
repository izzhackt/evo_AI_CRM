import { LEAD_CHANNEL_AI_NOTE, LEAD_CHANNEL_BASES, type LeadChannelBasis } from "@/lib/lead-channel-contract";
import type { CohortChannelRow } from "@/lib/marketing-contract";

/** Слова и числа «Маркетинга» в новом виде — те же, что у прежних файлов (`MarketingOverviewView`), собраны в одном месте. */
export const n = (value: number) => value.toLocaleString("ru-RU");

export function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const ones = count % 10;
  return `${n(count)} ${tens >= 11 && tens <= 14 ? many : ones === 1 ? one : ones >= 2 && ones <= 4 ? few : many}`;
}
export const leadsWord = (count: number) => plural(count, "лид", "лида", "лидов");
export const contractsWord = (count: number) => plural(count, "договор", "договора", "договоров");

const BASIS_ORDER: readonly LeadChannelBasis[] = ["utm", "referrer", "staff", "corrected", "unknown"];

/** Чем подтверждён канал: «по метке 3 · со слов клиента 2»; анкеты платформы и ИИ-помощник названы отдельно. */
export function channelBasisLine(row: CohortChannelRow, cabinetForms: number): string | null {
  const parts = BASIS_ORDER.filter((key) => row.basis[key] > 0 && !(row.channel === "unknown" && key === "unknown"))
    .map((key) => `${LEAD_CHANNEL_BASES[key]} ${n(row.basis[key])}`);
  if (row.channel === "unknown" && cabinetForms > 0) parts.push(`из них анкеты на платформе ${n(cabinetForms)}`);
  if (row.aiAssistant > 0) parts.push(`${LEAD_CHANNEL_AI_NOTE} ${n(row.aiAssistant)}`);
  return parts.length ? parts.join(" · ") : null;
}

export const dayText = (iso: string) => iso.split("-").reverse().join(".");
