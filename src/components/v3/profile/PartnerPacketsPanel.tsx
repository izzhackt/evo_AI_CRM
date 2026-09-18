import type { ActivePlatformActor } from "@/lib/platform-auth";
import { readPartnerPackets } from "@/lib/v3/case-operations-source";
import { PartnerPacketWorkspace } from "./CaseOperationsForms";
import { partnerPacketExport as words } from "@/lib/v3/wording";

export async function PartnerPacketsPanel({ actor, caseId, active, applications, initiallyOpen = false }: { actor: ActivePlatformActor; caseId: string; active: boolean; applications: readonly { id: string; name: string }[]; initiallyOpen?: boolean }) {
  const workspace = await readPartnerPackets(actor, caseId).catch(() => null);
  return <details className="scroll-mt-20 rounded-card border border-border bg-surface p-4 sm:p-5" id="partner-packets" open={initiallyOpen}><summary className="min-h-11 cursor-pointer font-semibold text-fg">{words.title}</summary>
    {!workspace ? <p role="alert" className="text-sm text-danger">{words.unavailable}</p>
      : <PartnerPacketWorkspace key={caseId} caseId={caseId} active={active} applications={applications} workspace={workspace} />}
  </details>;
}
