import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { readLeadInterest } from "@/lib/v3/manual-lead-source";

export type LeadInterestState = Readonly<{ status: "value"; direction: string } | { status: "none" } | { status: "error" }>;

/** Чтение «Интересует» одно для двух видов экрана: прежней строки «Сведений» и сводки «Нового вида». */
export async function readLeadInterestState(leadId: string): Promise<LeadInterestState> {
  const actor = await requirePlatformStaffActor();
  try {
    const direction = await readLeadInterest(actor, leadId);
    return direction === null ? { status: "none" } : { status: "value", direction };
  } catch {
    return { status: "error" };
  }
}

/**
 * «Интересует» в «Сведениях» Lead 360: направление, которое указали при создании лида
 * (`readLeadInterest`, своё чтение, как у «Откуда узнал»). Лид без дела не держит вкладку «Анкета»
 * ради одной этой строки. Не выбрано — строки нет; сбой чтения — слова, не пустота.
 */
export async function LeadInterestFact({ leadId }: Readonly<{ leadId: string }>) {
  const state = await readLeadInterestState(leadId);
  if (state.status === "error") {
    return (
      <div className="min-w-0 border-b border-border py-2.5 last:border-b-0">
        <dt className="t-caption text-fg-2">Интересует</dt>
        <dd role="alert" className="mt-0.5 t-body-compact text-fg-2">не прочитано</dd>
      </div>
    );
  }
  if (state.status === "none") return null;
  return (
    <div className="min-w-0 border-b border-border py-2.5 last:border-b-0">
      <dt className="t-caption text-fg-2">Интересует</dt>
      <dd className="mt-0.5 min-w-0 break-words t-body-compact text-fg" data-testid="v3-lead-interest">{state.direction}</dd>
    </div>
  );
}
