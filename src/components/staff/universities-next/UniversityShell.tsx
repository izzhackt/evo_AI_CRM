import type { ComponentProps } from "react";

import type { PartShell } from "../PartShell";
import { UniversityFrameNextLazy } from "./UniversitiesNextLazy";

/**
 * Рамка страниц «Университетов» «Нового вида» (единственный вид, #1327): рамка набора, подгружается лениво. Страницы зовут её вместо `PartShell` (те же свойства). Заголовок, число, строка места, возврат
 * и главное действие те же; `dense` и `fill` рамка не использует.
 */
export function UniversityShell(props: ComponentProps<typeof PartShell>) {
  const { title, count, meta, action, back, children } = props;
  return <UniversityFrameNextLazy title={title} count={count} meta={meta} actions={action} back={back}>{children}</UniversityFrameNextLazy>;
}
