"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DetailSheet } from "@/components/kit/DetailSheet";
import type { CoverageCurator } from "@/lib/platform-case-coverage-contract";

import { sheetEscape } from "../panel/sheet-escape";
import { CuratorCoverageForm } from "./CuratorCoverageForm";
import { coverageHref, type StudentsCoverage } from "./students-coverage-view";

const LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * «Сменить куратора» прямо в карточке дела (чек-лист 23.11): та же форма замещения, что в «Нагрузке кураторов»
 * (`manage_case_coverage`, перенос задач, плановый возврат), но в боковой панели, без ухода со страницы. Панель
 * открыта адресом `panel=curator`; закрыть — вернуться на тот же адрес без панели. Постоянной смены куратора без
 * возврата в базе нет: это замещение, и форма так и говорит.
 *
 * Как у «Нагрузки кураторов»: прочитанное однажды не пропадает при неудачном перечитывании — форма остаётся с
 * черновиком (сама не даёт отправить без свежих данных). Esc в поле не закрывает панель (`sheetEscape`), а пока
 * сохранение идёт, панель не закрывается вовсе: иначе ответ сохранения никто не увидит.
 */
export function CuratorChangeSheet({ coverage, requestId, today, closeHref }: Readonly<{
  coverage: StudentsCoverage;
  requestId: string;
  /** Сегодня в Бишкеке, YYYY-MM-DD. */
  today: string;
  /** Карточка без панели: сюда ведут «Отмена», крестик, Esc и сохранение. */
  closeHref: string;
}>) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState(false);
  const ready = coverage.kind === "ready" ? coverage : null;
  // Последние прочитанные кураторы: перечитывание не удалось — форма и черновик остаются.
  const [lastCurators, setLastCurators] = useState<readonly CoverageCurator[] | null>(ready?.workspace.curators ?? null);
  if (ready && ready.workspace.curators !== lastCurators) setLastCurators(ready.workspace.curators);
  const close = (next: boolean) => {
    if (!next && pending) return;
    setOpen(next);
    if (!next) router.replace(closeHref, { scroll: false });
  };
  const curatorId = "curatorId" in coverage ? coverage.curatorId : null;
  const preview = ready?.workspace.preview ?? null;
  // Куратора уже сменили (закладка, другой сотрудник): форма показывает актуального, а это сказано строкой.
  const moved = preview !== null && curatorId !== null && preview.owner_id !== curatorId;
  return (
    <DetailSheet title="Сменить куратора" open={open} onOpenChange={close}
      onEscapeKeyDown={(event) => { if (pending) { event.preventDefault(); return; } sheetEscape(event); }}>
      {moved ? <p role="status" className="t-body-compact text-fg-2">Куратор этого дела уже сменился: форма — по актуальному назначению.</p> : null}
      {lastCurators ? (
        <CuratorCoverageForm preview={preview} curators={lastCurators} requestId={requestId} today={today}
          returnHref={closeHref} onPendingChange={setPending} />
      ) : null}
      {!lastCurators || (ready && !preview) ? (
        <p role="alert" className="t-body-compact text-fg-2">Данные для смены куратора сейчас недоступны. Закройте панель и попробуйте ещё раз.</p>
      ) : null}
      {curatorId ? <Link href={coverageHref(curatorId)} className={LINK}>Все дела куратора — в «Нагрузке кураторов»</Link> : null}
    </DetailSheet>
  );
}
