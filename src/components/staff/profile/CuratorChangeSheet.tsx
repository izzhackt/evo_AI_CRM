"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DetailSheet } from "@/components/kit/DetailSheet";

import { CuratorCoverageForm } from "./CuratorCoverageForm";
import { coverageHref, type StudentsCoverage } from "./students-coverage-view";

const LINK = "inline-flex min-h-11 items-center t-label text-fg-2 underline underline-offset-4 hover:text-fg";

/**
 * «Сменить куратора» прямо в карточке дела (чек-лист 23.11): та же форма замещения, что в «Нагрузке кураторов»
 * (`manage_case_coverage`, перенос задач, плановый возврат), но в боковой панели, без ухода со страницы. Панель
 * открыта адресом `panel=curator`; закрыть — вернуться на тот же адрес без панели. Постоянной смены куратора без
 * возврата в базе нет: это замещение, и форма так и говорит.
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
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) router.replace(closeHref, { scroll: false });
  };
  const ready = coverage.kind === "ready" ? coverage : null;
  const curatorId = "curatorId" in coverage ? coverage.curatorId : null;
  const preview = ready?.workspace.preview ?? null;
  // Куратора уже сменили (закладка, другой сотрудник): форма по старому владельцу не подходит.
  const moved = preview !== null && curatorId !== null && preview.owner_id !== curatorId;
  return (
    <DetailSheet title="Сменить куратора" description="Замещение: заместитель ведёт дело до даты возврата." open={open} onOpenChange={close}>
      {ready && preview && !moved ? (
        <CuratorCoverageForm preview={preview} curators={ready.workspace.curators} requestId={requestId} today={today} returnHref={closeHref} />
      ) : moved ? (
        <p role="status" className="t-body-compact text-fg-2">Куратор этого дела уже сменился. Закройте панель, чтобы увидеть актуального.</p>
      ) : (
        <p role="alert" className="t-body-compact text-fg-2">Данные для смены куратора сейчас недоступны. Закройте панель и попробуйте ещё раз.</p>
      )}
      {curatorId ? <Link href={coverageHref(curatorId)} className={LINK}>Все дела куратора — в «Нагрузке кураторов»</Link> : null}
    </DetailSheet>
  );
}
