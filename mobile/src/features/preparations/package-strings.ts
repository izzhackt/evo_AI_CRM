// Тексты комплекта программы: словарь комплектов веба (`components/portal/applicationPackages/strings.ts`, RU и KY без копий)
// с подменой строки, которая в вебе просит «обновить страницу».
import { packageStrings, type PackageStrings } from "@web/components/portal/applicationPackages/strings";
import { useMemo } from "react";

import { useLang } from "@/i18n/LangProvider";

export type { PackageStrings };

export function usePackageStrings(): PackageStrings {
  const { lang, m } = useLang();
  return useMemo(() => ({ ...packageStrings(lang), storage: m("prep.packageStorage") }), [lang, m]);
}
