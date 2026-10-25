import { getLocale } from "@/lib/i18n";
import { getBoundaryStrings, boundaryLocale } from "@/lib/portal/boundary-i18n";

export default async function TestsLoading() {
  const t = getBoundaryStrings(boundaryLocale(await getLocale()));
  return (
    <main className="pt-page" data-pt-loading="" aria-busy="true">
      <p role="status" className="pt-run-text">{t.testsLoading}</p>
    </main>
  );
}
