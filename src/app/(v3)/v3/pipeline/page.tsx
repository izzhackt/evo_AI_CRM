import Link from "next/link";

import { Pipeline } from "@/components/v3/Pipeline";
import { readPipelineLeads, readPipelineStages } from "@/lib/v3/pipeline-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Воронка продаж" };

export default async function PipelinePart() {
  const [stages, leads] = [readPipelineStages(), await readPipelineLeads()];

  return (
    <main className="mx-auto w-full max-w-[1240px] px-4 py-8 sm:px-6">
      <Link href="/v3" className="-ms-1 inline-flex min-h-11 items-center px-1 font-mono text-xs text-accent-text hover:underline">
        ← Части интерфейса
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-fg">
        Воронка продаж
      </h1>
      <p className="mt-1 max-w-[56ch] text-sm leading-6 text-fg-3">
        {leads.length} лидов из канонической PostgreSQL, по стадиям. Карточка
        несёт имя и ведёт в полный профиль.
      </p>

      <div className="mt-6">
        <Pipeline stages={stages} leads={leads} />
      </div>
    </main>
  );
}
