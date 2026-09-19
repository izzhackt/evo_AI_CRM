import type { Metadata } from "next";

import { TestsCatalog } from "@/components/portal/tests/TestsCatalog";
import { getLocale } from "@/lib/i18n";
import { getPortalStrings } from "@/lib/portal/i18n";
import { readStudentAssessments } from "@/lib/v3/student-assessment-source";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Тесты — EVO Admissions" };

/**
 * Раздел «Тесты» в «Атласе» (PORT-8c): каталог english36/orvis92 и история
 * попыток. Чтение — прежний E2-источник student-assessment-source без
 * изменений контракта; подписи — неймспейс tests (RU/KY).
 */
export default async function StudentTestsPage() {
  const [catalog, locale] = await Promise.all([readStudentAssessments(), getLocale()]);
  const strings = getPortalStrings("tests", locale);
  return (
    <main className="pt-page">
      <header className="pt-page-header">
        <p className="pt-page-kicker">{strings.kicker}</p>
        <h1 className="pt-page-title">{strings.title}</h1>
        <p className="pt-page-lead">{strings.lead}</p>
      </header>
      <TestsCatalog catalog={catalog} locale={locale} />
    </main>
  );
}
