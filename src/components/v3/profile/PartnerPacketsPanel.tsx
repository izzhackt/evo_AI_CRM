import type { ActivePlatformActor } from "@/lib/platform-auth";
import { readPartnerPackets } from "@/lib/v3/case-operations-source";
import { PartnerPacketWorkspace } from "./CaseOperationsForms";
import { partnerPacketExport as words } from "@/lib/v3/wording";

export async function PartnerPacketsPanel({ actor, caseId, active, applications }: { actor: ActivePlatformActor; caseId: string; active: boolean; applications: readonly { id: string; name: string }[] }) {
  const workspace = await readPartnerPackets(actor, caseId).catch(() => null);
  return <details className="rounded-card border border-border bg-surface p-4 sm:p-5" id="partner-packets"><summary className="min-h-11 cursor-pointer font-semibold text-fg">{words.title}</summary>
    <p className="my-3 text-sm leading-6 text-fg-2">{words.hint}</p>
    {!workspace ? <p role="alert" className="text-sm text-danger">{words.unavailable}</p>
      : <PartnerPacketWorkspace key={caseId} caseId={caseId} active={active} applications={applications} workspace={workspace} />}
  </details>;
}
