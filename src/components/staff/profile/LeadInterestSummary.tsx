import { requirePlatformStaffActor } from "@/lib/platform-guards";
import { readLeadInterest } from "@/lib/v3/manual-lead-source";

export async function LeadInterestSummary({ leadId }: Readonly<{ leadId: string }>) {
  const actor = await requirePlatformStaffActor();
  let direction: string | null;
  try { direction = await readLeadInterest(actor, leadId); }
  catch { return <p role="alert" className="px-4 py-3 text-sm text-fg-2">Не удалось прочитать интересующее направление.</p>; }
  return <p className="px-4 py-3 text-sm text-fg-2">Интересующее направление: <span className="text-fg">{direction ?? "пока не выбрано"}</span></p>;
}
