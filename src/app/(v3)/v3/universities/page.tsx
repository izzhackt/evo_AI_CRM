import { isStaffPreview, staffHasPermission } from "@/lib/platform-access";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { PartShell } from "@/components/v3/PartShell";
import { UniversityList, UniversityUnavailable } from "@/components/v3/universities/UniversityCatalogue";
import { requireV3PageActor } from "@/lib/platform-guards";
import { parseUniversityFilters } from "@/lib/platform-university-catalog";
import { readStaffUniversityCatalogue, readStaffUniversityCountries } from "@/lib/v3/university-source";
import { catalogueServerPage, catalogueSortedPage, sortCatalogueRows } from "@/lib/v3/university-view";
export const dynamic = "force-dynamic";
export const metadata = { title: "Университеты" };
export default async function UniversitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [actor, params] = await Promise.all([requireV3PageActor("/v3/universities"), searchParams]);
  const filters = parseUniversityFilters(params) ?? notFound();
  const canManage = !isStaffPreview(actor) && staffHasPermission(actor, "catalog.import.manage");
  // Управление каталогом это редкая задача Admin (Э6): тихие ссылки, не красная кнопка.
  // Города и курсы валют кабинета студента (план 7.5) рядом, без нового пункта меню.
  const quiet = "inline-flex min-h-11 items-center gap-1.5 t-label text-fg-2 underline underline-offset-4 hover:text-fg";
  const manageAction = canManage ? (
    <div className="flex flex-wrap gap-x-4 max-sm:-my-2">
      <Link href="/v3/universities/cities" className={quiet}>Города</Link>
      <Link href="/v3/universities/rates" className={quiet}>Курсы валют</Link>
      <Link href="/v3/universities/manage" className={quiet}><Icon name="settings" size={16} />Управлять каталогом</Link>
    </div>
  ) : undefined;
  let catalogue, facet;
  try { [catalogue, facet] = await Promise.all([readStaffUniversityCatalogue(actor, filters), readStaffUniversityCountries(actor)]); } catch { return <PartShell title="Университеты" action={manageAction}><UniversityUnavailable /></PartShell>; }
  const now = new Date();
  // Общий порядок по сроку — только из полного чтения; каталог за пределом — страницы сервера по названию.
  const page = catalogue.kind === "complete"
    ? catalogueSortedPage(sortCatalogueRows(catalogue.items, filters.level, now), filters.offset)
    : catalogueServerPage(catalogue.page.items, filters.offset, catalogue.page.nextOffset, filters.level, now);
  return <PartShell title="Университеты" count={page.total} action={manageAction}><UniversityList page={page} filters={filters} countries={facet.countries} canManage={canManage} now={now} /></PartShell>;
}
