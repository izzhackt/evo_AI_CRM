import { Pipeline } from "@/components/v3/Pipeline";
import { requirePlatformSalesActor } from "@/lib/platform-guards";
import { readPipelineLeads, readPipelineStages } from "@/lib/v3/pipeline-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Воронка продаж" };

export default async function PipelinePart() {
  const actor = await requirePlatformSalesActor();
  const [stages, leads] = [readPipelineStages(), await readPipelineLeads(actor)];

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
        Воронка продаж
      </h1>

      <div className="mt-6">
        <Pipeline stages={stages} leads={leads} />
      </div>
    </main>
  );
}
