import type { ComponentProps } from "react";

import { PartShell } from "../PartShell";
import { UniversityFrameNextLazy } from "./UniversitiesNextLazy";

/**
 * Рамка страниц «Университетов»: прежняя `PartShell` или, в «Новом виде», рамка набора. Страницы зовут её вместо `PartShell`:
 * разметка прежнего вида не меняется (те же свойства), а новая подгружается лениво. Заголовок, число, строка места, возврат
 * и главное действие у обоих видов одни; `dense` и `fill` — только прежнего.
 */
export function UniversityShell({ nextUi, ...props }: { nextUi: boolean } & ComponentProps<typeof PartShell>) {
  if (!nextUi) return <PartShell {...props} />;
  const { title, count, meta, action, back, children } = props;
  return <UniversityFrameNextLazy title={title} count={count} meta={meta} actions={action} back={back}>{children}</UniversityFrameNextLazy>;
}
