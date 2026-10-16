import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Icon } from "@/components/icons";
import { PartShell } from "@/components/v3/PartShell";
import { FxRates } from "@/components/v3/universities/geography/FxRates";
import { requireV3PageActor } from "@/lib/platform-guards";
import { canManageCatalogGeography, readStaffCatalogGeography } from "@/lib/v3/catalog-geography-source";

export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };

/** Курсы валют для ориентира в USD (план 7.5): последний курс каждой валюты и пометка старше 45 дней. */
export default async function UniversityRatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [actor, params] = await Promise.all([requireV3PageActor("/v3/universities"), searchParams]);
  if (!canManageCatalogGeography(actor)) redirect("/access-denied?from=%2Fv3%2Funiversities");
  if (Object.keys(params).length) notFound();
  const back = <Link href="/v3/universities" className="inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 hover:text-fg hover:underline hover:underline-offset-4"><Icon name="arrow-left" size={16} />Все университеты</Link>;
  let geography;
  try { geography = await readStaffCatalogGeography(actor); } catch {
    return <PartShell title="Курсы валют" back={back}><p role="alert" className="rounded-card border border-border bg-surface p-5 t-body-compact text-danger">Не удалось загрузить курсы. Обновите страницу: это не значит, что курсов нет.</p></PartShell>;
  }
  return (
    <PartShell title="Курсы валют" back={back} meta="Ориентир в USD у стоимости вузов">
      <FxRates geography={geography} today={new Date().toISOString().slice(0, 10)} />
    </PartShell>
  );
}
