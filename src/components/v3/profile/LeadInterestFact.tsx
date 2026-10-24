import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { readLeadInterest } from "@/lib/v3/manual-lead-source";

/**
 * «Интересует» в «Сведениях» Lead 360: направление, которое указали при создании лида
 * (`readLeadInterest`, своё чтение, как у «Откуда узнал»). Лид без дела не держит вкладку «Анкета»
 * ради одной этой строки. Не выбрано — строки нет; сбой чтения — слова, не пустота.
 */
export async function LeadInterestFact({ leadId }: Readonly<{ leadId: string }>) {
  const actor = await requirePlatformStaffActor();
  let direction: string | null;
  try { direction = await readLeadInterest(actor, leadId); }
  catch {
    return (
      <div className="min-w-0 border-b border-border py-2.5 last:border-b-0">
        <dt className="t-caption text-fg-2">Интересует</dt>
        <dd role="alert" className="mt-0.5 t-body-compact text-fg-2">не прочитано</dd>
      </div>
    );
  }
  if (direction === null) return null;
  return (
    <div className="min-w-0 border-b border-border py-2.5 last:border-b-0">
      <dt className="t-caption text-fg-2">Интересует</dt>
      <dd className="mt-0.5 min-w-0 break-words t-body-compact text-fg" data-testid="v3-lead-interest">{direction}</dd>
    </div>
  );
}
