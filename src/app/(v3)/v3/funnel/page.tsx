import Link from "next/link";

import { Funnel } from "@/components/v3/Funnel";
import { readAdmissionsFunnel } from "@/lib/v3/funnel-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "V3 · Воронка" };

export default async function FunnelPart() {
  const stages = await readAdmissionsFunnel();

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
      <Link href="/v3" className="-ms-1 inline-flex min-h-11 items-center px-1 font-mono text-xs text-fg-2 underline decoration-border-strong underline-offset-4 hover:decoration-fg-2">
        ← Части интерфейса
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-fg">
        Воронка поступления
      </h1>
      <p className="mt-1 max-w-[56ch] text-sm leading-6 text-fg-3">
        Ступени и конверсия читаются из канонической PostgreSQL одним запросом.
      </p>

      <div className="mt-6 rounded-card bg-surface p-5">
        <Funnel stages={stages} caption="Воронка поступления" />
      </div>
    </main>
  );
}
