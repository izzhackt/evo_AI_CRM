import { randomUUID } from "node:crypto";

import { Pipeline } from "@/components/v3/Pipeline";
import { requireV3PageActor } from "@/lib/platform-guards";
import {
  readPipelineLeads,
  readPipelineOwnerOptions,
  readPipelineStages,
} from "@/lib/v3/pipeline-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Воронка продаж" };

export default async function PipelinePart() {
  const actor = await requireV3PageActor("/v3/pipeline");
  if (
    actor.presentationRole !== "admin" &&
    actor.presentationRole !== "sales"
  ) {
    throw new Error("Sales route resolved a non-Sales staff role.");
  }
  const stages = readPipelineStages();
  const [leads, ownerOptions] = await Promise.all([
    readPipelineLeads(actor),
    readPipelineOwnerOptions(actor),
  ]);
  const requestIds = Object.fromEntries(
    leads.map((lead) => [lead.id, randomUUID()]),
  );

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
        Воронка продаж
      </h1>

      <div className="mt-6">
        <Pipeline
          stages={stages}
          leads={leads}
          ownerOptions={ownerOptions.rows}
          ownerOptionsHaveMore={ownerOptions.hasNext}
          actorRole={actor.presentationRole}
          actorMembershipId={actor.membershipId}
          requestIds={requestIds}
        />
      </div>
    </main>
  );
}
