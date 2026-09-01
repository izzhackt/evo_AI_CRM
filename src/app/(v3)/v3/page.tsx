import { Funnel } from "@/components/v3/Funnel";
import { readAdmissionsFunnel } from "@/lib/v3/funnel-source";

export const dynamic = "force-dynamic";

export const metadata = { title: "V3 · Воронка" };

/**
 * Полигон для частей нового интерфейса. Здесь они собираются по одной на
 * настоящих данных, прежде чем сойтись в одну главную страницу.
 */
export default async function V3Page() {
  const stages = await readAdmissionsFunnel();

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">
        Воронка поступления
      </h1>
      <p className="mt-1 max-w-[56ch] text-sm leading-6 text-fg-3">
        Ступени и конверсия читаются из канонической PostgreSQL одним запросом.
      </p>

      <section className="mt-6 rounded-card bg-surface p-5">
        <Funnel stages={stages} caption="Воронка поступления" />
      </section>
    </main>
  );
}
