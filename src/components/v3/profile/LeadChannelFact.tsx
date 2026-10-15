import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import type { ActivePlatformActor } from "@/lib/platform-auth";
import { leadChannelText } from "@/lib/lead-channel-contract";
import { readLeadChannel } from "@/lib/v3/lead-channel-source";
import { LeadChannelCorrection } from "./LeadChannelCorrection";

/**
 * «Откуда узнал: канал · основание» в «Сведениях» Lead 360 (`read_lead_channel_v1`, 264). Свои чтение
 * и вид, как у «Заявок с сайта»: сбой чтения — слова, не «не известно». Исправить может тот, кто
 * ведёт лид (`lead.sales.workflow.manage`); просмотр роли только показывает.
 */
export async function LeadChannelFact({ actor, leadId, requestId }: Readonly<{ actor: ActivePlatformActor; leadId: string; requestId: string }>) {
  const state = await readLeadChannel(actor, leadId);
  if (state.status !== "available") return <span className="text-fg-2">не прочитано</span>;
  const canCorrect = !isStaffPreview(actor) && staffHasPermission(actor, "lead.sales.workflow.manage");
  return (
    <>
      <span data-testid="v3-lead-channel" data-channel={state.read.channel} data-basis={state.read.basis} className="v3-channel">
        <span aria-hidden="true" className="v3-channel-dot" />
        <span>{leadChannelText(state.read)}</span>
      </span>
      {canCorrect ? <LeadChannelCorrection leadId={leadId} requestId={requestId} current={state.read.channel} /> : null}
    </>
  );
}
