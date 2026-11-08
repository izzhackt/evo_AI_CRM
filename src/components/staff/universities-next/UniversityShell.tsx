import type { ComponentProps, ReactNode } from "react";

import type { PartShell } from "../PartShell";
import { UniversityFrameNextLazy } from "./UniversitiesNextLazy";

/**
 * Рамка страниц «Университетов» «Нового вида» (единственный вид, #1327): рамка набора, подгружается лениво. Страницы зовут её вместо `PartShell` (те же свойства). Заголовок, число, строка места, возврат
 * и главное действие те же; `dense` и `fill` рамка не использует.
 */
/** `tabs` — ряд вкладок под шапкой («Все вузы» / «По странам», виды страны). */
export function UniversityShell(props: ComponentProps<typeof PartShell> & { tabs?: ReactNode }) {
  const { title, count, meta, action, back, tabs, children } = props;
  return <UniversityFrameNextLazy title={title} count={count} meta={meta} actions={action} back={back} tabs={tabs}>{children}</UniversityFrameNextLazy>;
}
